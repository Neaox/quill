# R5 — Draft locking

**Question.** Does the ADR-021 lock/draft design (single `INSERT ... ON CONFLICT DO UPDATE ...
WHERE` acquire, 15s heartbeat / 60s expiry, admin/editor takeover, optimistic
`draft_version`) actually give exactly-one-holder guarantees under concurrency, and are the
15s/60s numbers right?

**Time box.** One day. Answer feeds `docs/research/r05-draft-locking.md` and the
Accepted/Revise decision on ADR-021.

## What this spike contains

- `sql/schema.sql` — the `spike_r5.document_lock` and `spike_r5.draft` tables.
- `src/db.ts` — pool + schema setup/drop/truncate helpers. Reads `SPIKE_R5_DATABASE_URL`
  (defaults to `postgres://quill:quill@localhost:5432/quill`, i.e. the repo's
  `docker compose` Postgres).
- `src/lock.ts` — `acquireLock`, `heartbeat`, `releaseLock`, `adminTakeover`. Every function
  takes `now: Date` as an explicit argument; nothing in this module calls `new Date()` or
  SQL `now()`, so tests drive time deterministically.
- `src/draft.ts` — `initDraft`, `getDraft`, `writeDraft` (optimistic version check, gated on
  the caller actually holding a valid lock).
- `src/*.test.ts` — vitest suite, see below.
- `src/bench.ts` — latency benchmark (`node src/bench.ts`).

## Running it

Requires the repo's Postgres running: `docker compose up -d postgres` from the repository
root (started automatically for this spike; left running afterwards).

```bash
cd spikes/r5-draft-locking
pnpm install --ignore-workspace
node src/setup-schema.ts     # creates schema spike_r5 (idempotent)
pnpm test                    # runs the vitest suite (9 tests)
node src/bench.ts            # latency benchmark, prints p50/p95/p99
node src/drop-schema.ts      # drops schema spike_r5
```

`vitest.config.ts` sets `fileParallelism: false`: every test file shares the same Postgres
schema and truncates it in `beforeEach`, so files must run one at a time or one file's
truncate races another file's fixtures.

## Test coverage (mapped to the R5 brief)

| # | Scenario | Test file |
| - | -------- | --------- |
| a | 50 iterations × 20-way concurrent acquire on the same document: exactly one winner | `src/race.test.ts` |
| b | Expiry after 60s without heartbeat allows a new holder | `src/lock.test.ts` → `expiry` |
| c | Heartbeat every 15s keeps the lock (20 ticks = 300s, four times the raw TTL) | `src/lock.test.ts` → `heartbeat` |
| d | Admin takeover causes the previous holder's next draft write to be rejected | `src/draft.test.ts` → `admin takeover` |
| e | Two tabs of the same user (same session): stale `draft_version` is rejected | `src/draft.test.ts` → `optimistic draft versions` |
| f | Release on close frees the lock immediately (no elapsed time needed) | `src/lock.test.ts` → `release` |
| g | Simulated network partition: client resumes heartbeating after expiry and is told it lost the lock, not kept alive silently | `src/lock.test.ts` → `heartbeat` → "reports loss ..." |

All 9 tests pass (`pnpm test`).

## Findings

1. **The acquire query gives a real single-winner guarantee.** `INSERT ... ON CONFLICT (document_id)
   DO UPDATE ... WHERE expires_at < $now OR holder_session_id = $self RETURNING *` relies on
   Postgres taking a row-level lock on the conflicting row before evaluating `WHERE`; concurrent
   `INSERT`s serialize on that row automatically. 50 iterations of 20 concurrent attempts each
   produced exactly one row from `RETURNING`, with zero flaky iterations, and zero deadlocks or
   serialization-failure retries needed — no `SERIALIZABLE` isolation or explicit advisory lock
   required.
2. **The `WHERE` clause is a strict `<`, not `<=`.** A caller who calls `acquireLock` at exactly
   `expires_at` (to the millisecond) does **not** win — expiry must be strictly in the past. In
   practice this only matters at benchmark-grade timing precision; wall-clock heartbeats give a
   comfortable margin. Worth documenting in the ADR so nobody "fixes" it into an off-by-one bug
   later.
3. **Heartbeat needs to fail closed on its own, without waiting for a takeover.** A heartbeat
   whose session still matches the row but whose `expires_at` has already passed must be treated
   as loss, even if nobody else has acquired the document yet ("network partition" scenario, test
   g). The row is otherwise indistinguishable from a currently-valid lock except for the timestamp,
   so the heartbeat query itself carries `AND expires_at >= $now`, not just `holder_session_id = $self`.
4. **A draft write must re-check lock validity, not just `draft_version`.** The version check alone
   cannot detect a takeover: the taken-over row keeps incrementing `draft_version` normally under
   its *new* holder, so a version match by itself doesn't imply the caller still owns the lock. The
   write path (`writeDraft`) does `SELECT ... FOR UPDATE` on the lock row inside the same transaction
   as the version check, so a concurrent takeover can't interleave between "check" and "write".
5. **Two rejection reasons are genuinely different and the client needs to know which.** `lock_lost`
   (someone else now owns editing rights; changes must be preserved locally and offered for
   recovery/merge) is a different situation from `stale_version` (the caller still owns the lock;
   just re-read and retry — typically because the user's other tab, sharing the same session, wrote
   first). Conflating them either nags a rightful editor to "reload, you lost your lock" when they
   didn't, or silently lets a locked-out editor keep typing into the void.
6. **Latency, 100 concurrent editors on distinct documents, local Postgres 17 (Docker), warm
   pool of 100 connections** (see `src/bench.ts`, three runs):

   | Operation | p50 | p95 | Round trips |
   | --- | --- | --- | --- |
   | acquire | ~17-18ms | ~20ms | 1 |
   | heartbeat | ~12ms | ~13-14ms | 1 |
   | write (optimistic, lock-checked) | ~47-48ms | ~49-50ms | 5 (`BEGIN`, 2×`SELECT ... FOR UPDATE`, `UPDATE`, `COMMIT`) |

   With a **cold** pool (connections opened on demand instead of pre-warmed), the first
   operation that has to open all 100 physical connections pays that cost instead — acquire
   latency was 3-10x higher purely from Postgres backend-process startup, not from lock
   contention (there is none here; each editor uses a distinct document). This is a connection-
   pool sizing concern for the real server, not a locking-design concern: keep a long-lived,
   adequately-sized pool rather than opening connections per request.
7. **The write path's 5 round trips are the main latency cost**, not the lock or version logic
   themselves. A production implementation could likely collapse the two `SELECT ... FOR UPDATE`
   checks and the `UPDATE` into fewer statements (e.g. a single `UPDATE ... FROM (SELECT lock
   check) ... WHERE draft_version = $expected RETURNING *` plus one extra disambiguating read only
   on rejection) — not implemented here because the separate-checks version makes the two failure
   modes trivial to distinguish and test, which mattered more for a spike than shaving one round
   trip.

## Recommendation

See `docs/research/r05-draft-locking.md` for the full write-up, parameter recommendation, and
API contract. Short version: keep 15s heartbeat / 60s expiry as-is (they hold up under the
tests above and the measured latencies are a small fraction of either interval), but revise
ADR-021 to say explicitly (a) heartbeat fails closed on its own expiry, independent of
takeover, (b) draft writes re-validate lock ownership every time, not just `draft_version`,
and (c) the client-facing contract distinguishes `lock_lost` / `stale_version` / session-expired
as three different HTTP responses, not one generic 409.

## Cleanup

`docker compose down` is **not** run by this spike — Postgres is left running per the task
instructions. Schema `spike_r5` is dropped by `node src/drop-schema.ts` (run at the end of the
investigation).
