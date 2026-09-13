# Security review closure: M2 server

**Date:** 2026-09-12
**Closes:** `docs/security/review-2026-09-12-m2-server.md`
**Standard:** ADR-011 (`docs/architecture/decisions/0011-authentication-and-security-baseline.md`) and `docs/security/checklist.md`. Context: ADR-012 (tenancy resolver), ADR-021 (locking), ADR-033 (expand-only migrations, additive API), ADR-034 (configuration).
**Scope of the work:** `apps/server/**` (except the seed, which another stream owns), the repository ports and use cases in `packages/application/**`, the generated client in `packages/api-client`, `.env.example`, and `apps/server/README.md`.

**Gate at the time of writing**

```
pnpm exec vitest run --project packages --project server
                                                191 files, 2143 tests, all passing
… with --coverage over apps/server/src and packages/application/src
                                                statements 100%, branches 100%,
                                                functions 100%, lines 100%
pnpm --filter @quill/server typecheck           green
pnpm --filter @quill/application typecheck      green
pnpm --filter @quill/api-client typecheck       green
pnpm exec oxlint apps/server packages/application    green (0 errors; the pre-existing
                                                no-await-in-loop warnings are unchanged)
pnpm exec oxfmt --check apps/server packages/application docs   clean
pnpm lint:deps                                  no violations (780 modules)
pnpm changelog:check                            valid
pnpm --filter @quill/server export-openapi      48 operations across 35 paths
pnpm --filter @quill/api-client generate        regenerated
```

## Executive summary

Every finding in the review is closed except two, and both of those are named
here with what is left and who has it.

The two that are not fully closed are **M13** (the seed's hard-coded
administrator password, which lives in a file another stream owns) and **M11**
(the same seed has yet to adopt the service method this change exposes for it).
The production guard on the seed *is* in place; what is missing is the
password, and that is a one-line change in `scripts/seed.ts`.

Three things in this pass are worth flagging before the table, because they
change behaviour a client can see:

- Links now carry their token in the **URL fragment** and are bound to the
  browser that asked for them. The server half is done and the query form
  never existed server-side, but **the web app has work to do** — see "Web
  follow-ups" at the end.
- `POST /api/auth/magic-link` now accepts only `purpose: 'sign-in'` and no
  longer creates an account. That is a deliberate narrowing of an endpoint,
  recorded in the changelog.
- `/api/openapi.json` is no longer served under `NODE_ENV=production`.

## Findings from the review

### High

| # | Verdict | Where it is proved |
|---|---|---|
| H1 | **PASS** (closed elsewhere, re-verified) | `routes/workspaces.ts` calls `listVisibleDocuments`, which runs the same materialise-and-combine pass the tree does; `packages/application/src/use-cases/list-visible-documents.test.ts`, `routes/workspaces.integration.test.ts` "lists the documents of a workspace to anyone who may read it" |
| H2 | **PASS** | `application/sign-in-timing.test.ts` "hashes exactly once whether or not the address already has an account", plus the wall-clock case with its tolerance stated |
| H3 | **PASS** | `sign-in-timing.test.ts` "queues rather than sends a magic link / a password reset…" and the two wall-clock cases; `auth-service.test.ts` "audits an unknown address the same way it audits a known one"; `infrastructure/outbox/send-mail.test.ts` |
| H4 | **PASS** | `routes/locks.integration.test.ts` "a holder who loses the capability" (3 tests) |
| H5 | **PASS** | `packages/application/src/use-cases/update-document.test.ts` (11 tests); `routes/documents.integration.test.ts` "moving a document" (6 tests); migration `0004` adds the foreign key |
| H6 | **PASS** | `infrastructure/outbox/poller.test.ts` "never claims an event of a type nothing consumes, and is not blocked by one" and "dead-lettering"; `outbox/send-mail.test.ts` "createAcknowledgingConsumer" |
| H7 | **PASS** | `config.test.ts` "TRUST_PROXY" (6 tests); `app.test.ts` "trusting what is in front of the server" (3 tests) |

### Medium

| # | Verdict | Where it is proved |
|---|---|---|
| M1 | **PASS** | `auth/rate-limit.test.ts` "the bounded store" (3 tests); `reset` is wired into a successful sign-in (`routes/auth.ts`) |
| M2 | **PASS** (server half; web follow-up below) | `auth-service.test.ts` "binding a link to the browser that asked for it" (4 tests); `routes/auth.integration.test.ts` "asks a browser that did not request the link to confirm", "accepts an explicit confirmation in place of the cookie", "asks for confirmation on verification and reset links too" |
| M3 | **PASS** | `auth/email.test.ts`; `auth-service.test.ts` "finds the account however the address is cased or padded"; migration `0004` backfills and adds the unique index |
| M4 | **PASS** | `infrastructure/http/outbound-transport.test.ts` "pinnedLookup" (2 tests) and the `nodeFetch` cases that prove the socket goes where the lookup says |
| M5 | **PASS** | `outbound-transport.test.ts` "ipv6Bytes" (4 tests) and "isBlockedAddress, on the IPv6 forms a prefix check misses" (5 tests) |
| M6 | **PASS** | `infrastructure/http/outbound-client.test.ts` response-cap cases, now enforced while reading |
| M7 | **PASS** | `routes/auth.integration.test.ts` "refuses a magic-link request for any purpose but sign-in" and "creates no account for an unknown address asking for a link"; `auth-service.test.ts` "creates no account for an unknown address, and queues nothing"; `plugins/rate-limit.ts` `linkBucket` |
| M8 | **PASS** | `auth-service.test.ts` "refuses an unresolvable token before it does any expensive work"; the three consuming routes carry `addressRateLimit('link-consume')` |
| M9 | **PASS** | `plugins/openapi.test.ts` "serves neither the description nor the UI when the flag is off"; `app.test.ts` "does not serve the API docs when the configuration says not to"; `config.test.ts` "serves the API docs everywhere but production" |
| M10 | **PASS** | `auth/breached-password-corpus.test.ts` (9 tests), including the air-gapped instance |
| M11 | **PARTIAL** | `grantInstanceAdmin` exists and the fixture uses it (`test-support/tenancy-fixture.ts`); the seed has yet to adopt it — see "Carried forward" |
| M12 | **PASS** | `config.test.ts` "refusing to boot on an unsafe production combination" (3 tests) |
| M13 | **PARTIAL** | The production guard is in `scripts/seed-cli.ts`; the hard-coded administrator password is in `scripts/seed.ts`, which this change does not own — see "Carried forward" |
| M14 | **PASS** | `config.test.ts` "ignores SECURE_COOKIES=false on an https instance, and says so" and "refuses a cookie name without the __Host- prefix on a secure instance" |
| M15 | **PASS** | Migration `0004` adds both indexes; `jobs/sweep-expired.test.ts` (5 tests); `infrastructure/repositories/session-repository.test.ts` "deleteExpired", `magic-link-repository.test.ts` "deleteSpent" |

### Low

| # | Verdict | Where it is proved |
|---|---|---|
| L1 | **PASS** | `auth/session-cookie.test.ts` "clears the cookie with the attributes it was set with" and "carries Secure on a secure instance, when setting and when clearing" |
| L2 | **PASS** | Migration `0004` adds the cascading foreign key; `routes/locks.integration.test.ts` "a lock whose session is revoked"; `packages/application/src/test-support/in-memory-repositories.test.ts` "releases a session's locks when the session goes, as the foreign key does" |
| L3 | **PASS** | `plugins/request-id.test.ts` (8 tests): the header is taken only behind a configured proxy, and only when it is short and made of correlation-id characters |
| L4 | **PASS** | `poller.test.ts` "dead-lettering"; `jobs/job-runner.test.ts` "one poll at a time" |
| L5 | **PASS** | `createUnitOfWork` now requires an `IdGenerator`; every composition root passes one |
| L6 | **PASS** | Every route calls a use case or a server-side application service. `application/editing-service.ts` (locks and drafts), `packages/application/src/use-cases/collections.ts`, `tenancy.ts` and `update-document.ts` (units, workspaces, collections, documents), each writing the audit row the review noted was missing: `tenancy.test.ts`, `collections.test.ts`, `update-document.test.ts`, `routes/tenancy.integration.test.ts` "writes an audit row for every unit and workspace change", `routes/documents.integration.test.ts` "deleting a document" |
| L7 | **PASS** (closed by an earlier pass, re-verified) | The `inject-system-dependencies` rule matches the imported binding; `plugins/request-id.ts` and `db/test-database.ts` are the two call sites it was blind to |
| L8 | **PASS** | `infrastructure/repositories/lock-repository.test.ts` "acquire racing a release" (2 tests) |
| L9 | **PASS** (closed elsewhere, re-verified) | The render-cache key is `<render input hash>:<render version>` and carries no document identity; nothing marks entries stale any more (`schema.ts`'s `render_cache` comment, ADR-031 amendment) |
| L10 | **PASS** | The enumeration tests now assert cost as well as shape (`sign-in-timing.test.ts`); the harness's browser default is documented in `test-support/browser-client.ts` and overridden by `plugins/csrf.test.ts` and `auth.integration.test.ts` "cross-site protection", which prove CSRF is live through the real app |

### The five overstated closure-doc claims

1. **Finding 14 (Swagger).** Now genuinely closed: the JSON route is registered only when the flag is on, and `plugins/openapi.test.ts` asserts `404` for both paths when it is off.
2. **Finding 4 and "constant-shape responses".** Now closed for cost as well as shape, on all four endpoints — see H2 and H3.
3. **Finding 7 (breached passwords).** The mandated local fallback exists (`auth/breached-password-corpus.ts`), wired in `main.ts` behind whichever checker is configured.
4. **Rotation on privilege change.** `grantInstanceAdmin` makes the service method reachable from a script, and the test fixture goes through it. The seed is the last caller that does not — see below.
5. **Administrative actions audited.** Units, workspaces, collections and document deletion now write audit rows. Grant management still has no routes, so that half remains "no live path yet" rather than "not audited".

## How the seven high findings were closed

### H2 and H3 — the request paths now cost the same either way

Sign-up hashes **before** the branch, so an address that already has an
account pays for the same Argon2id hash as one that does not. `issueMagicLink`
mints a token, hashes it, mints a binding secret and hashes that on both
branches, and writes an audit row of the same shape either way; only the
insert and the outbox write are skipped when there is no account to attach
them to.

The larger difference was delivery. Waiting on SMTP is tens of milliseconds
and happened only on the branch that had an account, which is a reliable
answer to "does this person have an account here?" from anywhere. Mail is now
a `MailRequested` outbox event written in the same transaction as the token,
delivered by `infrastructure/outbox/send-mail.ts` on the job runner.

That puts a live token in `outbox_events.payload` until it is sent, which
ADR-011 would otherwise forbid, so `OutboxConsumer` gained an optional
`redactPayload` and the poller stores what it returns when it marks the event
processed. The delivered row keeps who and what; the credential is gone. The
exposure is the second or so a queued row waits, and it is written down here
because it is a deliberate trade rather than an oversight.

`application/sign-in-timing.test.ts` proves both halves: exact operation
counts, which are deterministic and fail the moment a hash moves inside a
branch, and a wall-clock comparison whose tolerance (40 ms against a 50 ms
hash) is stated in the file with the reasoning for the number.

### H4 — a lock is not a permission

`application/editing-service.ts` re-resolves `edit` on every heartbeat and
every draft write. It costs one scope-chain walk per fifteen seconds per
editor, which is the price of a revocation taking effect at all. A holder who
has lost the capability does not merely get a `403`: their lock is released on
the way out, so the document is available immediately rather than after a
further minute of a lock nobody can heartbeat.

### H5 — a destination that is real, and a caller who may use it

`packages/application/src/use-cases/update-document.ts` checks that the
destination collection is in this workspace, that the parent exists, is in
this workspace, and sits in the destination collection, and that nothing
becomes its own ancestor. The route asks the authorizer for `manage` at the
source *and* at every destination the patch names — which is what
`Authorizer.collection()` was added for, because a collection is a permission
scope of its own and asking the workspace instead would step over a grant made
at the collection.

Migration `0004` adds `documents_parent_id_fk` (`ON DELETE SET NULL`, so
deleting a parent lifts its children rather than taking them away), after
nulling any parent that is already dangling.

### H6 — nothing starves the outbox

The poller claims only types it has a consumer for, which was already in place
and is re-proved here; the other half is that a type nothing acts on still
needs somebody to mark it processed. `createAcknowledgingConsumer` is that,
registered for `DocumentCreated` with the reason attached, so a reader can tell
a deliberate no-op from a forgotten consumer. Events that fail
`MAX_OUTBOX_ATTEMPTS` times are dead-lettered with their last error and never
claimed again (L4).

### H7 — what is in front of the server

`TRUST_PROXY` takes nothing (the default, and the safe one), a hop count, or a
list of addresses and CIDR ranges; the blanket `true` is refused, because it
would believe any peer. It decides Fastify's `trustProxy` and whether a
caller-supplied `X-Request-Id` is honoured at all.

## Checklist walkthrough

### Authentication and sessions

| Item | Verdict | Evidence |
|---|---|---|
| Argon2id at/above OWASP minimum; parameters stored; re-hash on raise | **PASS** | `auth/password-schemes/argon2id.ts`; `password.test.ts` decodes the PHC string and asserts `m=19456,t=2,p=1`. Hashing is now a registry keyed by PHC identifier (`auth/password-scheme.ts`), so a stored hash says which scheme wrote it and `needsRehash` is true when that scheme is not current |
| Breached-password check on every new password; length 12–128; no composition rules | **PASS** | `auth/breached-password.ts` with `withLocalFallback` behind it; `breached-password-corpus.test.ts`; `auth.integration.test.ts` "password policy" |
| Magic-link/reset tokens: 256-bit, hashed, single use, 15 minutes, bound to the email, superseded | **PASS** | `auth/tokens.ts`, `magic-link-repository.ts`; and now bound to the *browser* as well as the address — `auth-service.test.ts` "binding a link to the browser that asked for it" |
| Constant-shape responses for sign-up, sign-in, magic link, reset | **PASS** | `auth.integration.test.ts` "no account enumeration"; `sign-in-timing.test.ts` for cost as well as shape |
| Session ids 256-bit, stored hashed; cookie `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` | **PASS** | `auth/session-token.ts`, `config.ts`; cleared with the same attributes (`session-cookie.test.ts`), and a `SESSION_COOKIE_NAME` without the prefix refuses to boot on a secure instance |
| Rotation on sign-in, privilege change, credential change; absolute and idle timeouts; revocation and "sign out everywhere" | **PASS** | `application/session-service.ts`; expired rows are now also swept rather than only deleted when presented (`jobs/sweep-expired.ts`) |
| State-changing requests check `Sec-Fetch-Site` and `Origin` | **PASS** | `plugins/csrf.ts`; `csrf.test.ts` |
| OIDC | **N/A YET** | M3 |
| Passkeys | **N/A YET** | M3 |

### Authorisation

| Item | Verdict | Evidence |
|---|---|---|
| Every route authorises through the domain resolver; no trust in ids from the client | **PASS** | Every route calls `requireDocumentAccess` / `requireWorkspaceAccess` / `requireCollectionAccess` / `requireInstanceAdmin`. A destination named in a PATCH is authorised as well as the source (H5), and `edit` is re-resolved on heartbeat and draft write (H4) |
| Share-link tokens random and hashed; expiry, revocation, policy, audit | **N/A YET** | The table has the right shape; no route creates or consumes one |
| Administrative actions audited | **PASS** for what has routes | Authentication, sessions, credentials and privilege changes (`application/audit.ts`); units, workspaces, collections and document deletion (`use-cases/tenancy.ts`, `collections.ts`, `update-document.ts`). Grant management still has no routes |

### Headers and transport

| Item | Verdict | Evidence |
|---|---|---|
| Strict CSP with nonces; no `unsafe-inline`/`unsafe-eval`; `frame-ancestors` set | **PASS** | `plugins/security-headers.ts`; `security-headers.test.ts` |
| HSTS behind TLS; `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` | **PASS** | Same |
| The deployment's own source address is what the limiter counts | **PASS** | `TRUST_PROXY`; `app.test.ts` "trusting what is in front of the server" |

### Input, output, content

| Item | Verdict | Evidence |
|---|---|---|
| All inputs schema-validated; unknown fields rejected | **PASS** | Every route declares TypeBox `body`/`params`/`querystring`; a supplied `X-Request-Id` is now bounded in length and charset too |
| Rendered Markdown sanitised on the server before caching; external links `rel="noopener noreferrer"` | **PASS** (closed elsewhere) | `packages/markdown/src/render/sanitize-schema.ts` |
| Outbound requests through a shared client: allowlist, private-DNS check, redirect limits, timeouts, size caps | **PASS** | `infrastructure/http/outbound-client.ts`; the connection now goes to the address that was checked, IPv6 is parsed rather than pattern-matched, and the cap is applied while reading |
| Uploads | **N/A YET** | No upload route exists |

### Abuse and observability

| Item | Verdict | Evidence |
|---|---|---|
| Rate limits with backoff on auth and share-link endpoints | **PASS** for auth; **N/A YET** for share links | One bucket per (account, purpose) across routes, an address bucket on the consuming endpoints, and a store that no longer grows without bound |
| Audit events for auth outcomes and permission changes; no secrets in logs | **PASS** | `application/audit.ts`; `auth-service.test.ts` asserts the event sequence and that no token, password or session token appears in any row |
| Timing-safe comparisons for every secret | **PASS** | `hashesMatch` for the session hash and now for the link binding; Argon2id's own verify for passwords |

### Supply chain

| Item | Verdict | Evidence |
|---|---|---|
| `pnpm audit` clean or exceptions recorded; build scripts allow-listed; secrets outside the repository | **PASS, with the exception carried over** | See "Accepted risks". No runtime dependency was added by this change: the outbound client's transport is `node:http`/`node:https` rather than a third-party agent, precisely so that pinning the connection address costs no new dependency |

## Carried forward

1. **M13 — the seed's administrator password.** `scripts/seed-cli.ts` now refuses
   to run under `NODE_ENV=production` without `SEED_ALLOW_PRODUCTION=1`, which
   is the half that stops the accident. The other half — taking the password
   from the environment with no default instead of hard-coding
   `admin-password-change-me` — is in `scripts/seed.ts`, which another stream
   owns while it extends the seed. It is a one-line change: read
   `SEED_ADMIN_PASSWORD` and refuse to run without it when
   `SEED_ALLOW_PRODUCTION=1` is set.
2. **M11 — the seed's privilege change.** `grantInstanceAdmin(deps, { actor,
   target })` is exported from `application/auth-service.ts` for exactly this:
   it rotates the target's sessions and writes the `auth.privilege.changed`
   row, which `users.setInstanceAdmin` does not. The fixture already uses it;
   the seed still calls the repository directly. Until it changes, the seeded
   administrator's elevation is unaudited — which is harmless on a laptop and
   is why this is carried rather than blocking.
3. **Grant-management routes.** There are still none, so "permission changes are
   audited" has a vocabulary and a recorder but no live path. Unchanged from
   the M1 closure.
4. **A queued magic link is a live token in the database until it is sent.**
   Deliberate, redacted on delivery, and explained under H2/H3 above. If the
   job runner is stopped, queued links sit unredacted until it runs again.
5. **Ports that changed.** `packages/application/src/ports/persistence.ts`
   gained `WorkspaceRepository.listAll`, `SessionRepository.deleteExpired`,
   `MagicLinkRepository.deleteSpent`, `CollectionRepository.rename` / `delete` /
   `countDocuments`, an optional `bindingHash` on `MagicLinkRepository.create`,
   and `bindingHash` on `MagicLinkTokenRow`. All additive; the in-memory doubles
   follow them mechanically.

## Migrations

One migration, `drizzle/0004_remarkable_satana.sql`, expand-only per ADR-033:

- `magic_link_tokens.binding_hash` and `outbox_events.dead_lettered_at`, both nullable.
- **An operator step, and the one thing in this migration that can fail loudly:**
  before the unique index on `lower(email)` is created, the migration raises an
  exception naming every address that several accounts share. If it stops there,
  merge or rename those accounts and run it again — it will not guess which of
  two accounts for one mailbox is the real one. Once the check passes, existing
  addresses are rewritten to their canonical form.
- `documents_parent_id_fk` (`ON DELETE SET NULL`), after nulling any dangling
  parent, and `document_locks_holder_session_id_sessions_id_fk`
  (`ON DELETE CASCADE`), after deleting any lock held by a session that no
  longer exists.
- Indexes on `sessions (user_id)`, `sessions (expires_at)`,
  `magic_link_tokens (user_id, purpose)` and `magic_link_tokens (expires_at)`.

## Web follow-ups

The server half of M2 is done; three things belong to the web app, and none of
them is blocked on further server work.

1. **Read the token from the fragment.** Mail now links to
   `/auth/magic-link#token=…`, `/auth/verify-email#token=…` and
   `/auth/reset-password#token=…`. The pages currently read
   `location.search`; they should read `location.hash`, post the token, and
   clear the fragment afterwards so it does not sit in the address bar.
   **Keep the query form working for one release** — links already in inboxes
   carry it, though they expire in fifteen minutes — and mark it deprecated.
2. **Handle `403 confirmation_required`.** The three consuming endpoints answer
   with that code when the request arrives without the
   `__Host-<slug>_link` cookie. The page should show a short confirmation
   ("Yes, it was me") and re-post the same token with `confirm: true`. Without
   it, a person who opens a link in a different browser is simply stuck.
3. **`POST /api/auth/magic-link` no longer takes a `purpose`.** It issues
   sign-in links only, and it no longer creates an account for an unknown
   address, so a "sign in with a link" form for a new visitor needs to point at
   sign-up instead. Any caller sending `purpose: 'password-reset'` gets `400`
   and should call `/api/auth/password-reset/request`.

## Deliberate design notes

- **Mail is queued, and the queued row is redacted on delivery.** The
  alternative — keeping delivery on the request path and padding the unknown
  branch with a fake SMTP round trip — would have been a lie in the code and a
  worse one in the logs. The exposure window is named above rather than hidden.
- **The IPv6 check parses rather than matches.** A prefix check is cheap and
  was wrong in at least three ways; sixteen bytes and an explicit table of
  embedded-IPv4 encodings is a few more lines and is right.
- **The transport is `node:https`, not `fetch`.** `fetch` cannot say "connect
  to this address, speak TLS for that name", which is exactly what a
  rebinding-proof client has to say. Using it would have meant a new runtime
  dependency for an agent; `node:https` says it directly.
- **The password scheme registry keys on the PHC identifier the hash already
  carries**, so no column and no migration is needed to tell schemes apart, and
  `verify` fails closed on one nothing recognises. Retiring a scheme is the
  asymmetric step, and it is written down in `auth/password-scheme.ts` rather
  than discovered later: holders of hashes it wrote must reset.
- **`TRUST_PROXY=true` is refused.** Every other setting here accepts the
  permissive spelling and warns; this one cannot, because "believe any peer"
  has no correct deployment.
- **A collection that still holds documents is not deleted.** `collection_id`
  is nullable, so the delete would succeed and quietly take every document it
  held out of the permission tree — unreachable for its owners, not merely
  untidy.

## Accepted risks

- **Dependency audit (2026-09-12):** `pnpm audit --prod` reports no known
  vulnerabilities. One moderate advisory (GHSA-67mh-4wv8-2f99, esbuild 0.24.2
  and below) is reachable only through `drizzle-kit`'s development loader; it
  concerns esbuild's own development server, which this project never runs.
  Accepted until drizzle-kit drops the dependency; re-checked by `pnpm audit`
  in CI.
- **A queued magic link is a usable token in `outbox_events` until the mail
  consumer delivers it**, at which point the row is redacted. Accepted as the
  price of removing an SMTP round trip from the request path; see H2/H3.
- **The bundled breached-password list is a floor, not a corpus.** A few
  thousand entries against the remote service's five hundred million. It only
  ever answers when the remote one cannot, and the
  `auth.breached_password.unavailable` audit event still fires, so an outage
  stays visible rather than becoming invisible.
