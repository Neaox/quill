# R5 — Draft locking

**Question.** Does the ADR-021 lock/draft design give a real single-holder guarantee under
concurrency, are the 15s heartbeat / 60s expiry values right, and what exact client/server
contract does the recovery flow need? This is the answer that lets ADR-021 move from
"Proposed" to "Accepted."

**Time box.** One day (2026-09-12), inside the R3/R4/R5 critical path. If the time box had
expired without a clear answer, the fallback would have been to accept ADR-021 provisionally
with a follow-up spike specifically for the concurrency claim, since that claim is the one
thing code review cannot verify by inspection.

## What was examined

A throw-away spike at `spikes/r5-draft-locking/` (deleted once this write-up and any ADR
edits land), built against the repository's real Postgres 17 (`docker compose up -d
postgres`), in a dedicated `spike_r5` schema:

- `sql/schema.sql` — `document_lock` (one row per document: holder user/session, acquired,
  last heartbeat, expiry) and `draft` (document, `draft_version`, `base_revision`, `ast`
  jsonb) — a direct implementation of quill-plan.md §10 and §11.
- `src/lock.ts` — `acquireLock` (the ADR-021 `INSERT ... ON CONFLICT DO UPDATE ... WHERE`),
  `heartbeat`, `releaseLock`, `adminTakeover`. Every function takes `now: Date` as an
  explicit argument bound as a SQL parameter (`$1::timestamptz`) — nothing calls `new Date()`
  or SQL `now()` inside the module, so tests control time deterministically and there is no
  reliance on the two ends of a test (JS clock, DB clock) agreeing.
- `src/draft.ts` — `writeDraft`: an optimistic, lock-gated write, executed as one transaction
  with `SELECT ... FOR UPDATE` on the lock row so the ownership check and the version check
  cannot be split by a concurrent takeover.
- A vitest suite (9 tests, all passing) covering the seven scenarios in the R5 brief.
- `src/bench.ts`: latency measurement, 100 concurrent simulated editors on 100 distinct
  documents, against local Postgres.

Full detail, including exact SQL, is in `spikes/r5-draft-locking/README.md`. This write-up
summarizes the findings that matter for the ADR decision; it does not restate the code.

## Findings

**Concurrency (test a).** 50 iterations of 20 simultaneous `acquireLock` calls against the
same document produced exactly one winner every time (1,000 attempts total, zero flaky
iterations, zero deadlocks). The mechanism relies on Postgres taking a row lock on the
conflicting row during `INSERT ... ON CONFLICT`, before the `WHERE` clause is evaluated, so
concurrent inserts against the same key serialize automatically — no `SERIALIZABLE`
isolation, advisory lock, or application-level mutex is needed. This is the ADR's central
claim and it holds.

**Expiry boundary is a strict `<`.** Calling acquire at exactly the row's `expires_at` (to
the millisecond) does not win; the row must be strictly expired. This only matters at
sub-millisecond timing precision and is not a practical concern given 15s/60s granularity,
but it is worth stating explicitly in the ADR so it reads as an intended contract, not an
accident someone "fixes" later into an off-by-one bug.

**Expiry (test b), heartbeat (test c), release (test f)** all behaved exactly as specified:
a lock is un-acquirable by anyone else until strictly past `expires_at`; 20 heartbeats at the
nominal 15s cadence held the lock across 300s (5x the raw 60s TTL) without a rival winning;
release deletes the row outright, so a rival can acquire in the same instant with zero
elapsed time — nothing waits for expiry.

**Heartbeat must fail closed on its own (test g).** The two ways a heartbeat can fail are
distinct and were both necessary to model:

- The row already expired, but nobody has taken it over yet (a network partition: the client
  stopped heartbeating, then resumed too late). The row still shows the caller as holder, but
  its `expires_at` is in the past.
- Someone else has since taken the document over — the row's `holder_session_id` no longer
  matches the caller.

The first case cannot be detected by checking `holder_session_id` alone (it still matches);
the heartbeat query must independently check `expires_at >= now`. Getting this wrong is the
one way ADR-021's "the client is told it lost the lock" guarantee could quietly fail: a
naive heartbeat that only checks `WHERE holder_session_id = $self` would happily keep
"succeeding" (0 rows updated is not the same as an error unless the caller checks
`rowCount`) or, worse, extend an already-abandoned lock's expiry indefinitely, defeating the
60s TTL entirely for a partitioned client that eventually reconnects.

**A draft write must re-validate the lock, not just `draft_version` (test d).** A takeover
does not reset or otherwise mark `draft_version`; the new holder's writes continue
incrementing it normally. So version continuity by itself cannot distinguish "the rightful
holder wrote again" from "a new holder wrote after taking over." `writeDraft` therefore
checks `holder_session_id` and `expires_at` against the lock row, inside the same transaction
(`SELECT ... FOR UPDATE`) as the version check, before accepting a write. Order matters: lock
ownership is checked first, so a write that is both lock-invalid and version-stale is
reported as `lock_lost` (the more actionable, more urgent signal) rather than
`stale_version`.

**`stale_version` and `lock_lost` are different failures needing different client behaviour
(test e).** Two tabs of the same login session share one `holder_session_id` (this is the
mechanism, not an incidental detail — it's how "two tabs of the same user" end up sharing a
lock instead of fighting over it via the acquire endpoint). When tab 1 writes first, tab 2's
write against the same `expectedVersion` is rejected as `stale_version`: tab 2 still owns the
lock fine, it just needs to re-read and retry (or, for now, prompt the user, since real
merging is out of scope until Yjs). This is a fundamentally different situation from
`lock_lost`, where the caller has to stop and enter the recovery flow below. Conflating the
two in a single generic 409 forces the client to guess, which risks either nagging a
rightful editor that they "lost their lock" when they didn't, or letting a locked-out editor
keep typing into a document it can no longer save.

**Latency — 100 concurrent editors, 100 distinct documents (no lock contention by
design — this measures cost, not the race), local Postgres 17 in Docker, three runs, pool
pre-warmed to 100 connections** (`node src/bench.ts`, `SPIKE_R5_POOL_MAX=100`):

| Operation | p50 | p95 | Round trips |
| --- | --- | --- | --- |
| acquire | 17-18 ms | 19-21 ms | 1 |
| heartbeat | 11-12 ms | 13-14 ms | 1 |
| draft write (lock-checked, optimistic) | 46-48 ms | 49-50 ms | 5 (`BEGIN`, 2×`SELECT ... FOR UPDATE`, `UPDATE`, `COMMIT`) |

With a cold pool (connections opened on demand rather than pre-warmed), the first operation
to open all 100 physical connections at once paid 3-10x this cost — pure Postgres
backend-process startup, not lock contention (there is none between distinct documents).
That is a connection-pool-sizing concern for the application server (keep a long-lived,
adequately sized pool), not a finding about the locking design itself, and is called out here
only so it isn't mistaken for a scalability problem with the lock table.

All three operations complete in well under 100ms even under 100-way concurrency, which is
what §4 below uses to judge whether 15s/60s leaves enough margin.

## Options

| Option | Strengths | Weaknesses | Rewrite risk if wrong |
| ------ | --------- | ---------- | ---------------------- |
| Keep 15s heartbeat / 60s expiry, tighten the spec (this recommendation) | Matches measured latency with large headroom (measured p95 write is 49ms, i.e. ~0.08% of the 60s window); one heartbeat can be silently dropped and two more can fail before the lock is at risk; no code changes needed, only ADR wording | A genuinely abandoned tab still blocks others for up to 60s | Low — purely a documentation change plus the two behavioural fixes already implemented and tested in the spike |
| Shorten expiry (e.g. 20-30s) to free abandoned locks faster | Reduces worst-case block time for a crashed tab | Cuts the heartbeat safety margin from 4x to ~1.5-2x, so a couple of dropped heartbeats under real-world network jitter (mobile networks, laptop sleep/wake) start producing false takeovers during normal use, which is worse than a slightly slower recovery from an actually-abandoned tab | Medium — would need to re-run the heartbeat-margin tests against real network conditions, not just Postgres latency, before trusting it |
| Lengthen expiry (e.g. 2-5 minutes) for extra safety margin | Even more tolerant of network blips | Makes the "browser crash must never leave a document locked" requirement (ADR-021's own stated goal) worse for no measured benefit — the current margin is already far larger than anything Postgres latency requires | Low, but pointless: there is no evidence problem it solves |
| Add a server-side sweeper for expired locks | Simpler mental model of "one process owns cleanup" | ADR-021 already rejected this (an extra process for something the acquire query already handles for free); nothing in this spike changes that trade-off | N/A — not revisited here |

## Recommendation

**Keep 15s / 60s as specified.** The measured latencies give enormous headroom (heartbeat
p95 of ~14ms against a 15s interval, draft write p95 of ~50ms against a 60s TTL), and the 4x
ratio between heartbeat interval and expiry already tolerates three consecutive dropped
heartbeats — several minutes of real editing under packet loss — before the lock is at risk.
Nothing measured here argues for changing either number.

**§4 — the worst-case blind-editing window, and what the client should do in it.** Because
takeover (other than by an admin) requires the lock to actually be expired, nobody else can
acquire the document during the 0-60s window after a client's last successful heartbeat —
there is no writer to conflict with yet, so this window is not a data-race window by itself.
The real risk is a *false sense of connection*: a client whose heartbeats are failing
(network partition) but which does not check the outcome of its own heartbeat calls will
keep accepting local edits as if they were safely lockable, right up to and past the moment
a takeover becomes possible. The fix is entirely client-side and does not require changing
the 60s number:

- Treat a heartbeat call that fails to complete (timeout, network error) exactly like an
  explicit `expired`/`taken_over` response for UI purposes — "uncertain" is not "fine." Retry
  immediately rather than waiting for the next scheduled 15s tick.
- Escalate visibly on *missed* heartbeats, before the hard 60s cutoff: show a "reconnecting"
  state after one missed heartbeat (~15s of silence) and a "your lock may be at risk" state
  after two (~30s), so the user has 30-45s of warning rather than a surprise at 60s.
  Continue buffering edits locally throughout (see §5) — do not block typing.
- On reconnect, do not resume autosave blindly. Re-validate ownership first (a heartbeat
  attempt doubles as this check) before flushing any queued writes.

With that client behaviour, the effective "editing with no valid lock and no warning" window
is close to zero — bounded by one heartbeat round-trip (~15ms measured) plus however long the
client's own timeout is set to, not by the 60s TTL.

**ADR-021 should move to Accepted, with these exact edits:**

1. Heartbeat: add "expiry is evaluated independently of takeover — a heartbeat whose
   session still matches the row but whose expiry has passed must fail, even if no one else
   has acquired the document yet." (Confirmed necessary by test g / finding above; the
   current ADR text only says heartbeat "extends expiry," which under-specifies the failure
   case that test g exists to catch.)
2. Optimistic draft versions: add "a write must also re-validate that the caller currently
   holds a non-expired lock; `draft_version` continuity alone does not detect a takeover,
   since the new holder's writes continue incrementing the same counter." (Confirmed by test
   d / finding above.)
3. Add the API contract in the next section to the ADR (or link to this document), so the
   distinction between `stale_version` and `lock_lost` is a shared contract from the start of
   implementation, not something the backend and frontend teams reinvent independently.
4. Note the strict-`<` expiry boundary as intentional.

No other part of the decision needs to change. The single-INSERT acquire mechanism, the
15s/60s values, one-lock-per-document, admin/editor takeover split, and optimistic versions
all held up under test.

## API contract for the client

Distinct HTTP status codes so the client can branch without parsing the body, with the body
carrying detail for the UI copy:

| Endpoint | Success | Failure |
| --- | --- | --- |
| `POST /documents/:id/lock/acquire` | `200 { lock: { holderUserId, holderSessionId, expiresAt } }` | `409 Conflict { reason: "held", holder: { holderUserId, displayName, expiresAt } }` |
| `POST /documents/:id/lock/heartbeat` | `200 { expiresAt }` | `410 Gone { reason: "expired" }` (own lock lapsed, free for anyone incl. self to reacquire) · `409 Conflict { reason: "taken_over", holder }` (someone else has it) · `404 Not Found { reason: "released" }` |
| `DELETE /documents/:id/lock` (release; also the `sendBeacon` target on navigation) | `204 No Content`, unconditionally (idempotent — a beacon can't read the response, so releasing a lock you don't hold is a harmless no-op, not an error) | — |
| `POST /documents/:id/lock/takeover` (admin only; editor takeover of an *expired* lock is just calling acquire again) | `200 { lock }` | `403 Forbidden` if caller is not an admin |
| `PUT /documents/:id/draft` | `200 { draftVersion, updatedAt }` | `423 Locked { reason: "lock_lost", holder: {...} \| null }` · `409 Conflict { reason: "stale_version", currentVersion }` · `401 Unauthorized { reason: "session_expired" }` |

`423 Locked` is used exclusively for "you don't currently hold a valid lock" and `409
Conflict` exclusively for "you hold the lock but your version is behind" — the client can
switch on status code alone for the primary branch (stop-and-recover vs. re-read-and-retry)
and use the body only to fill in who holds it / what the current version is.

## Client recovery flow (design)

1. **Local buffer.** Every accepted local edit is appended to an IndexedDB-backed queue,
   keyed by document and the `draft_version` it was based on, before any network call is
   made. An entry is removed only once the server acknowledges it with `200`. This makes
   "browser crash right before a request completes" and "tab closed offline" behave the same
   way: the edit survives in IndexedDB and is retried on the next session against the same
   document.
2. **Autosave loop.** Debounce edits, then `PUT /documents/:id/draft` with the queued
   `{ ast, expectedVersion }`. On `200`, advance the locally tracked version and pop the
   queue entry.
3. **`409 stale_version`.** The caller still holds the lock. Re-fetch the current draft,
   reconcile (for v1, without Yjs, this is expected almost exclusively from the same user's
   other tab — surface "updated in another tab, showing the latest version" rather than
   attempting a text merge), and retry the queued edit against the new version.
4. **`423 lock_lost`.** Stop autosave immediately — do not retry against the same lock. Keep
   every unsent entry in IndexedDB (never discard on this path). Show the "your changes are
   preserved" recovery UI: who holds the document now (from the response body), and an
   explicit action once it's free again (re-acquire and replay the queue, or export/copy the
   buffered changes if the user needs to leave). This is the one path where the client must
   assume it cannot just keep going.
5. **`401 session_expired`.** Distinct from `lock_lost`: prompt re-authentication, keep the
   IndexedDB queue untouched, and after login re-validate lock + version (do not blindly
   flush) before resuming autosave.
6. **Reconnect (network back after a partition).** Never resume flushing the queue on the
   mere fact that requests are succeeding again. First re-validate — a heartbeat call doubles
   as this check — and branch on its result exactly as above (`200` → flush the queue in
   order; `410`/`409` on heartbeat → the document is free or taken, act accordingly; the lock
   was never silently kept alive across the gap).
7. **Presence.** Once a client is in the `lock_lost` or "someone else is editing" state,
   polling (and later SSE, per ADR-021) tells it who currently holds the document, so the
   recovery UI can say "Reclaim once Priya is done" rather than a bare error.

## Consequences

Accepting ADR-021 as revised commits the project to: a locking module tested with a fake
clock, two simulated clients, a network-partition scenario, and a takeover scenario (already
built and passing here, to be ported into the real `packages/*` test suite when the feature
is implemented — this spike's tests are the template, not the final suite); a client that
never treats "no error yet" as "still holds the lock" after any period of silence; and a
documented three-way HTTP contract (`423` / `409` / `401`) that both the Fastify routes and
the web client commit to before the editor is built, rather than improvising per-endpoint
error shapes later. It makes real-time co-editing (Yjs, later) easier, not harder: the lock
row and `draft_version` this spike validates are exactly what ADR-021 says the future Yjs
document replaces the lock with, on the same draft row.

## Resulting ADR

`docs/architecture/decisions/0021-draft-and-locking-model.md` — recommend moving from
"Proposed, pending research R5" to "Accepted," with the four edits listed under
Recommendation applied to its Decision section.
