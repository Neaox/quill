# Security review closure: M1 authentication, sessions, and transport

**Date:** 2026-09-12
**Closes:** `docs/security/review-2026-09-12-m1-auth.md`
**Standard:** ADR-011 (`docs/architecture/decisions/0011-authentication-and-security-baseline.md`) and `docs/security/checklist.md`. Context: ADR-012 (tenancy resolver), ADR-021 (locking), ADR-033 (expand-only migrations, additive API).
**Scope of the work:** `apps/server/**`, plus `SessionRepository` and `MagicLinkRepository` in `packages/application/src/ports/persistence.ts` and their in-memory test doubles, which had to follow the ports.

**Gate at the time of writing**

```
pnpm --filter @quill/server typecheck          green
pnpm --filter @quill/application typecheck     green
pnpm exec oxlint apps/server packages/application   green (0 errors; the pre-existing
                                                no-await-in-loop warnings are unchanged)
pnpm exec oxfmt apps/server packages/application    clean
pnpm exec vitest run apps/server packages/application --coverage
                                                73 files, 620 tests, all passing
                                                statements 100%, branches 100%,
                                                functions 100%, lines 100%
pnpm --filter @quill/server export-openapi      43 operations across 33 paths
pnpm --filter @quill/api-client generate        regenerated
pnpm --filter @quill/api-client typecheck       green
```

## Executive summary

Every finding this review set out to close is closed, each with a test that fails if the fix is
removed. The two findings the original review called Critical that were not about sessions —
broken access control on documents, drafts and locks (1), and the unsanitised Markdown renderer
(3) — were closed by other work and are re-verified below rather than re-fixed here.

The one thing that is *not* closed is a deployment check rather than a code fix, and it is
finding 15: nothing prevents `MAIL_DRIVER=dev` outside a developer's machine. It is carried
forward with the smallest honest fix named.

## Findings from the original review

| # | Severity | Verdict | Where it is proved |
|---|---|---|---|
| 1 | Critical | **PASS** (closed elsewhere, re-verified) | `routes/*.ts` now authorise through `application/authorization.ts`; `routes/documents.integration.test.ts`, `locks.integration.test.ts` |
| 2 | Critical | **PASS** | `routes/auth.integration.test.ts` "stores a hash of the session token, never the token itself" |
| 3 | Critical | **PASS** (closed elsewhere, re-verified) | `packages/markdown/src/render/sanitize-schema.ts`, `escape-raw-html.ts`, `external-link-rel.test.ts` |
| 4 | High | **PASS** | `auth.integration.test.ts` "answers sign-up identically for a new and an existing email" |
| 5 | High | **PASS** | `application/sign-in-timing.test.ts` (four cases, one verify each); `auth/password.test.ts` `verifyDummy` |
| 6 | High | **PASS** | `auth.integration.test.ts` "rate limiting" (4 tests); `plugins/rate-limit.test.ts`; `auth/rate-limit.test.ts` |
| 7 | High | **PASS** | `auth-service.test.ts` "refuses a password the breach corpus knows"; `auth/breached-password.test.ts` |
| 8 | High | **PASS** | `auth.integration.test.ts` "password policy" and "cross-site protection"; `plugins/csrf.test.ts`; `plugins/security-headers.test.ts` |
| 9 | Medium | **PASS** | `config.test.ts` "cookie security" (6 tests) |
| 10 | Medium | **PASS** (closed elsewhere, re-verified) | `workspaces.integration.test.ts`; `routes/workspaces.ts` requires `view` through the resolver |
| 11 | Medium | **PASS** | `auth.integration.test.ts` "invalidates an outstanding reset link when a newer one is issued" |
| 12 | Medium | **PASS** | `tenancy.integration.test.ts` "email verification" (2 tests); `plugins/session.test.ts` `requireVerifiedSession` |
| 13 | Low | **PASS** | `auth/password.test.ts` "encodes the OWASP-minimum parameters in the hash it writes"; `auth-service.test.ts` "re-hashes a credential stored below the current parameters" |
| 14 | Low | **PASS** | `app.test.ts` "does not serve the API docs when the configuration says not to" |
| 15 | Low | **OPEN** | Deployment configuration; see below |

## The eleven fixes, one at a time

### 1. Sessions

**What changed.** The cookie now carries a 256-bit token from `crypto.randomBytes`
(`auth/session-token.ts`); the `sessions` row stores only its SHA-256 in a new `token_hash`
column and keeps its opaque `id` as the row key, so `document_locks.holder_session_id` and the
new management routes go on naming a session without being able to resume it. Lookups are an
indexed equality on the hash, and the match is then confirmed with `crypto.timingSafeEqual`
(`hashesMatch`), which is the comparison the checklist asks for.

`application/session-service.ts` owns the whole lifecycle: issue, authenticate, rotate, list,
revoke. Both clocks are enforced there — absolute (30 days, `expires_at`) and idle (7 days,
measured from `last_seen_at`) — and a session past either is deleted rather than merely refused,
so a clock change cannot resurrect it. `last_seen_at` is stamped at most once a minute, which
keeps an authenticated read from costing a write.

Rotation happens on sign-in (a new session every time), on password change (every other session
revoked, this one rotated), on reset (every session revoked), and on privilege change
(`authService.setInstanceAdmin` revokes the affected user's sessions).

Revocation is additive routes under `/api/auth/sessions`: `GET` lists, `DELETE /:id` revokes one,
`DELETE` signs out everywhere. Another user's session id answers `404`, never `403`, so the route
is not an existence oracle either.

**Migration.** `drizzle/0002_sour_stark_industries.sql` adds `token_hash` (nullable, unique) and
`last_seen_at` (nullable) — expand only, per ADR-033. A row written before the change has no
token hash, so no cookie can reach it, and `idleDeadline` falls back to `created_at` for it.

**Tests.** `auth/session-token.test.ts` (entropy, encoding, hashing, the length guard before
`timingSafeEqual`); `application/session-service.test.ts` (issue, rotate both ways, absolute and
idle expiry, the legacy null `last_seen_at` row, list, revoke, revoke-all-but-one);
`plugins/session.test.ts` (the same through HTTP, including "never stores the value the cookie
carries" and "does not write on every request"); `infrastructure/repositories/session-repository.test.ts`;
`routes/auth.integration.test.ts` "session management" (6 tests).

### 2. Cookie

**What changed.** `config.ts` derives `secureCookie` from the scheme of `APP_URL`, never from
`NODE_ENV`, and names the cookie `__Host-quill_session` exactly when that cookie really is
`Secure` — the prefix is a promise the browser enforces, so claiming it on a non-Secure cookie
would be worse than not claiming it. A plain-`http` `APP_URL` is accepted only for `localhost`,
`127.0.0.1` or `[::1]`; anything else refuses to boot with a message naming ADR-011.
`HttpOnly`, `SameSite=Lax`, `Path=/` and no `Domain` were already right and still are.

The config surface stayed additive: `SECURE_COOKIES` is still honoured, and using it emits a
deprecation warning through an injectable sink (`process.emitWarning` by default) so a test can
capture it. When it is used to force `Secure` off, the `__Host-` prefix is dropped with it.

**Tests.** `config.test.ts` "cookie security": the https case, the three loopback spellings, the
refusal, "ignores NODE_ENV entirely", the deprecated override (including the prefix being
dropped), and the default warning sink. `routes/auth.integration.test.ts` "sets an httpOnly,
SameSite=Lax, Path=/ cookie with no Domain".

### 3. CSRF

**What changed.** `plugins/csrf.ts` adds an `onRequest` hook on every POST, PUT, PATCH and
DELETE: `Sec-Fetch-Site`, when present, must be `same-origin` or `none`; `Origin`, when present,
must equal `config.appOrigin`. A refusal is `403 cross_origin_rejected` with the reason in
`details`, distinct from the ordinary `403 forbidden` that is about what a user may do.

**The chosen policy for a request with neither header**, since the review asked for it either
way: such a request is a non-browser client and is allowed **only while it carries no session
cookie**. Every browser released since 2020 sends fetch metadata, so a request that omits it
*and* presents a session cookie is not a browser acting for the user; refusing it costs a
scripted client one header and closes the gap that "absent means allowed" would leave. The
policy is written out in the module's own doc comment, and both halves are tested.

`app.inject` is exactly that headerless client, so `test-support/browser-client.ts` states once,
per harness, that the test client is a same-origin browser — a test that wants the other answer
still passes its own header, which wins.

**Tests.** `plugins/csrf.test.ts` (12 cases: allowed same-origin, `none`, every state-changing
method refused cross-site, `same-site` refused, origin mismatch, and the four no-metadata
cases). `routes/auth.integration.test.ts` "cross-site protection" proves it end to end through
the real app.

### 4. Security headers

**What changed.** `plugins/security-headers.ts` registers `@fastify/helmet` with
`enableCSPNonces`, so every response mints a nonce, appends `'nonce-…'` to `script-src` and
`style-src`, and exposes it as `reply.cspNonce` for any HTML this server renders. The policy has
no `unsafe-inline` and no `unsafe-eval` anywhere, and sets `frame-ancestors 'none'`,
`object-src 'none'`, `base-uri 'self'` and `form-action 'self'`. HSTS (two years,
`includeSubDomains`, `preload`) is asserted only when `config.https` — a plain-http instance
must not pin a scheme it cannot serve. `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options:
DENY`, and a `Permissions-Policy` denying camera, microphone and geolocation are all set.

The Swagger UI inlines its own boot script, so `/api/docs` gets a relaxed policy — and only when
`serveApiDocs` is true, which `config.ts` makes false under `NODE_ENV=production`. That also
closes finding 14: `main.ts` no longer forces the docs on.

**Tests.** `plugins/security-headers.test.ts` (7 tests: the strict policy, a fresh nonce per
response reaching `reply.cspNonce`, the full header set, HSTS on and off, and the docs exemption
present and absent). `routes/auth.integration.test.ts` "security headers" asserts they are on an
error response too.

### 5. No account enumeration

**What changed.** Sign-up always answers `202 {}`. When the address already has an account,
nothing about that account changes and its owner gets a "you already have an account, sign in
instead" email through the mailer — out of band, where the person asking cannot see it. The
`Mailer` port gained `sendAccountExists`, implemented by both drivers.

Sign-in performs exactly one Argon2id verify on every call: against the stored hash when there
is one, and against a hash of a random value nobody holds when there is no user or no
credential. Shape parity was already there; this is the "and similar time" half.

That dummy hash is built **at composition time**, not lazily on first use. `password.ts` exports
`createPasswordHasher()`, an async factory that computes it once from `ARGON2_PARAMETERS` and
returns a `PasswordHasher` — `hash`, `verify`, `needsRehash`, `verifyDummy`. The composition
roots (`main.ts`, `seed-cli.ts`, `export-openapi.ts`, the test harness) await it once and pass it
down through `AppDependencies` and `AuthServiceDeps`; the auth service calls `deps.passwords.*`
rather than importing the functions. The shape matters for two reasons beyond tidiness: a lazy
module-level cache would make *one* unlucky request pay hash-plus-verify while every later one
paid only verify — a timing difference on the exact path whose timing is the finding — and
mutable module state on a security path is state nothing can reset between tests.

**Tests.** `routes/auth.integration.test.ts` "no account enumeration" asserts identical status
*and* body for sign-up, sign-in, magic-link request and reset request on both branches.
`application/sign-in-timing.test.ts` is the review's own named test: it injects a counting fake
hasher and asserts exactly one verify per `signIn` in all four cases — no account, no
credential, wrong password, right password. `auth/password.test.ts` keeps the real Argon2id: it
asserts the encoded parameters, and that `verifyDummy` really calls `verify` with a valid
`$argon2id$…` PHC string at those parameters, the same hash every time, and a different one per
hasher.

### 6. Passwords

**What changed.** The schemas are `minLength: 12, maxLength: 128`, any Unicode, no composition
rules. The hasher passes `memoryCost: 19456, timeCost: 2, parallelism: 1` and Argon2id
explicitly rather than inheriting library defaults, `readArgon2Parameters` decodes a PHC string,
and `needsRehash` compares a stored hash against the parameters in force; `signIn` re-hashes and
persists when it is below them, which is the only moment the plaintext is in hand.

`BreachedPasswordChecker` (`auth/breached-password.ts`) is a three-valued port — `ok`,
`breached`, `unavailable` — because a corpus that is down is not a clean password. The HIBP
implementation goes through the outbound client of fix 9 with the range host as its entire
allowlist, sends only the first five hex characters of the SHA-1, asks for padding, and matches
the suffix locally. It is wired into sign-up, reset, and the new password-change route. An
`unavailable` verdict fails open **and writes an `auth.breached_password.unavailable` audit
event**, which is the only way anyone notices the check has been quietly absent for a week.
`test-support/fakes.ts` has the in-memory fake every test uses, so the suite never reaches the
network.

**Tests.** `auth/password.test.ts` decodes the hash and asserts `m=19456,t=2,p=1` numerically,
plus `needsRehash` on each axis and an unparseable hash. `auth-service.test.ts` proves the
re-hash on sign-in and that a current hash is left alone. `auth/breached-password.test.ts`
proves the password never leaves the instance, the hit, the miss, the zero-count padding entry,
and all three unavailable paths. `routes/auth.integration.test.ts` "password policy" proves
`400` under 12 and over 128, and acceptance of a Unicode passphrase.

### 7. Tokens

**What changed.** `MagicLinkRepository` gained `supersede(userId, purpose, now)`, one
`UPDATE … WHERE consumed_at IS NULL`, and `issueMagicLink` calls it before inserting the new
token — so a stale reset email in an inbox stops being a live credential the moment a newer one
is sent. How many it retired goes into the audit row. Single-use under concurrency was already
correct (`consume` is a conditional update) and is now covered by a race test on each of the
three purposes.

**Tests.** `routes/auth.integration.test.ts` "invalidates an outstanding reset link when a newer
one is issued"; `auth-service.test.ts` "supersedes an outstanding link of the same purpose" and
"leaves a link of a different purpose alone"; three "rejects a second concurrent redemption"
tests; `in-memory-repositories.test.ts` "supersedes only the unconsumed links of one user and
purpose".

### 8. Rate limiting

**What changed.** `auth/rate-limit.ts` is now a real limiter with a window that *grows*: a key
that exhausts its window gets the next one doubled, up to a cap, and drops back to the base
window after one it survives. That is ADR-011's "exponential backoff rather than hard lockout" —
an attacker cannot lock a victim out, and cannot get an unbounded retry budget either. It
exposes a `@fastify/rate-limit` store, so the plugin does the HTTP work (429, `Retry-After`, the
`x-ratelimit-*` headers) and a test can inject the store and drive it with the fake clock.

Two dimensions are limited on sign-in, sign-up, magic link, password reset, password change and
lock takeover: the source address (route-level `config.rateLimit`) and the account the request
names (a `preHandler`, which runs after body parsing so it can read the email). Either alone is
easy to route around. A refusal is the usual `{ error: { code: 'rate_limited', … } }` shape with
`retryAfterSeconds`, and is written to the audit log without holding the response up.

**Tests.** `auth/rate-limit.test.ts` (the doubling, the cap, the drop-back, the store contract);
`plugins/rate-limit.test.ts` (429 shape, recovery, the account dimension across addresses,
case-insensitivity, a request naming no account, the address dimension alone, the audit hook);
`routes/auth.integration.test.ts` "rate limiting" (a sign-in burst then the right password
succeeding after the window, one account across four addresses, the mail-bomb endpoints, and the
audit row).

### 9. Outbound HTTP client

**What changed.** `infrastructure/http/outbound-client.ts` is the single client every
server-side fetch goes through. It takes a host allowlist; resolves the hostname and refuses if
*any* address is loopback, private, link-local, carrier-grade NAT, multicast, or one of the
cloud metadata addresses (169.254.169.254 and 192.0.0.192), including IPv4-mapped IPv6 spellings
of them; follows redirects by hand with a cap, re-running every check on each hop; times out;
and caps the response size against both the declared `Content-Length` and the bytes actually
read. Failures carry a typed `reason` on `OutboundRequestError`. `fetch` and the resolver are
parameters, so the tests drive the whole decision table without a network.

**Tests.** `infrastructure/http/outbound-client.test.ts` (24 cases), including the SSRF case an
allowlist alone would miss: an allowed host that redirects to `metadata.internal`, and an
allowed host whose second hop resolves to loopback.

### 10. Email verification enforced

**What changed.** `plugins/session.ts` gained `app.requireVerifiedSession`, and every route that
creates or changes tenancy, documents, drafts or grants uses it: `POST/PATCH/DELETE /api/units`,
`POST/PATCH/DELETE /api/workspaces`, `POST /api/workspaces/:id/documents`,
`POST/PATCH/DELETE` on documents, `PUT /api/documents/:id/draft`, and all four lock routes.
Reads keep `requireSession`. `/api/me` and the auth routes are deliberately not gated — a user
who has not verified must still be able to see who they are and ask for a new link.

**Tests.** `routes/tenancy.integration.test.ts` "email verification": an unverified *instance
admin* is refused `403 email_not_verified` on `POST /api/units`, and the same account still
reads `/api/me`. `plugins/session.test.ts` covers the decorator directly.

### 11. Audit

**What changed.** `application/audit.ts` names the events and writes them through the existing
`AuditWriter`, which nothing had been calling. Sign-up (both branches), sign-in success and
failure with a reason, sign-out, rate-limited, session revoked, sign-out-everywhere, password
changed, password reset, password re-hashed, email verified, magic link issued (with how many it
superseded), breach-check unavailable, breached password rejected, and privilege changed all
write a row. `recordInBackground` exists for the one path — a rate-limit refusal — where waiting
on a database write would turn one failure into two; a failed write is logged rather than
swallowed.

No row carries a secret. A session's *row id* is safe to record precisely because of fix 1: it
is no longer what the cookie carries.

**Tests.** `application/audit.test.ts` (the recorder, the background helper, and its failure
path). `auth-service.test.ts` "records the outcome of every authentication, with no secret in
any row" asserts the exact event sequence for a whole journey and then asserts the serialised
rows contain neither the password, nor the session token, nor the magic-link token — the
capture the review asked for.

## Checklist walkthrough

### Authentication and sessions

| Item | Verdict | Evidence |
|---|---|---|
| Argon2id at/above OWASP minimum; parameters stored; re-hash on raise | **PASS** | `auth/password.ts`; `password.test.ts` decodes the PHC string and asserts `m=19456,t=2,p=1`; `auth-service.test.ts` proves the re-hash |
| Breached-password check on every new password; length 12–128; no composition rules | **PASS** | `auth/breached-password.ts` wired into sign-up, reset and change; `routes/auth.ts` schemas; `auth.integration.test.ts` "password policy" |
| Magic-link/reset tokens: 256-bit, hashed, single use, 15 minutes, bound to the email, superseded | **PASS** | `auth/tokens.ts`, `magic-link-repository.ts` `supersede`; supersession and concurrency tests listed under fix 7 |
| Constant-shape responses for sign-up, sign-in, magic link, reset | **PASS** | `auth.integration.test.ts` "no account enumeration"; `sign-in-timing.test.ts` for the timing half |
| Session ids 256-bit, stored hashed; cookie `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` | **PASS** | `auth/session-token.ts`, `config.ts`; `auth.integration.test.ts` "stores a hash of the session token" and the cookie-attribute test |
| Rotation on sign-in, privilege change, credential change; absolute and idle timeouts; revocation and "sign out everywhere" | **PASS** | `application/session-service.ts`; `session-service.test.ts`, `plugins/session.test.ts`, `auth.integration.test.ts` "session management" |
| State-changing requests check `Sec-Fetch-Site` and `Origin` | **PASS** | `plugins/csrf.ts`; `csrf.test.ts` |
| OIDC: code flow with PKCE, `state`/`nonce`, issuer/audience validated | **N/A YET** | No OIDC code exists; ADR-011 places it in M3. Unchanged from the original review |
| Passkeys: user verification required, credential ids and sign counts checked | **N/A YET** | No WebAuthn code exists; M3 |

### Authorisation

| Item | Verdict | Evidence |
|---|---|---|
| Every route authorises through the domain resolver; no trust in ids from the client | **PASS** | `application/authorization.ts`; every route in `documents.ts`, `drafts.ts`, `locks.ts`, `workspaces.ts` calls `requireDocumentAccess`/`requireWorkspaceAccess`, and `units.ts` requires instance admin. Closed by the tenancy work, re-verified here |
| Share-link tokens random and hashed; expiry, revocation, policy, audit | **N/A YET** | The `share_links` table has the right shape; no route creates or consumes one |
| Administrative actions audited | **PARTIAL PASS** | Authentication, session, credential and privilege changes are audited (`application/audit.ts`). Unit, workspace and document CRUD still write no audit row — see "Carried forward" |

### Headers and transport

| Item | Verdict | Evidence |
|---|---|---|
| Strict CSP with nonces; no `unsafe-inline`/`unsafe-eval`; `frame-ancestors` set | **PASS** | `plugins/security-headers.ts`; `security-headers.test.ts` |
| HSTS behind TLS; `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` | **PASS** | Same; HSTS asserted only when `config.https` |

### Input, output, content

| Item | Verdict | Evidence |
|---|---|---|
| All inputs schema-validated; unknown fields rejected | **PASS** | Every route declares TypeBox `body`/`params`/`querystring`; the password-length tests show Ajv rejecting a bad body with `400 validation_error` |
| Rendered Markdown sanitised on the server before caching; external links `rel="noopener noreferrer"` | **PASS** (closed elsewhere) | `packages/markdown/src/render/sanitize-schema.ts`, `escape-raw-html.ts`, `external-link-rel.test.ts`; `rehypeStringify` now runs with `allowDangerousHtml: false` |
| Outbound requests through a shared client: allowlist, private-DNS check, redirect limits, timeouts, size caps | **PASS** | `infrastructure/http/outbound-client.ts`; `outbound-client.test.ts` |
| Uploads: size limits, sniffed content type, image re-encode, SVG sanitised, non-executing origin | **N/A YET** | No upload route exists |

### Abuse and observability

| Item | Verdict | Evidence |
|---|---|---|
| Rate limits with backoff on auth and share-link endpoints | **PASS** for auth; **N/A YET** for share links | `auth/rate-limit.ts`, `plugins/rate-limit.ts`, three test files |
| Audit events for auth outcomes and permission changes; no secrets in logs | **PASS** | `application/audit.ts`; `auth-service.test.ts` asserts the event sequence and that no token, password or session token appears in any row |
| Timing-safe comparisons for every secret | **PASS** | `hashesMatch` (`crypto.timingSafeEqual`) confirms the session-hash lookup; Argon2id's own verify for passwords; one verify per sign-in either way |

### Supply chain

| Item | Verdict | Evidence |
|---|---|---|
| `pnpm audit` clean or exceptions recorded; build scripts allow-listed; secrets outside the repository | **NOT EVALUATED** | The task's command allowlist excludes root `pnpm` commands, so `pnpm audit` was not run. `config.ts` still reads every secret from the environment with no in-repo default beyond the local dev database URL |

## Carried forward

1. **Finding 15 — the dev mailer can be selected outside development.** `MAIL_DRIVER` still
   defaults to `dev`, which logs live sign-in, verification and reset links to stdout. This is
   correct on a laptop and wrong anywhere else, and nothing in the code prevents it. Now that
   `config.ts` knows about `NODE_ENV` (it already gates the Swagger UI on it), the fix is one
   condition: refuse to boot with `MAIL_DRIVER=dev` when `NODE_ENV=production`. Left open
   deliberately — it changes startup behaviour for anyone currently relying on the default, so
   it wants its own change and its own note in the deployment documentation.
2. **Audit rows for tenancy and content administration.** Creating, renaming or deleting a unit,
   workspace or document writes no audit row. The recorder and the vocabulary now exist, so this
   is wiring rather than design; it belongs with the grant-management routes, which do not exist
   yet either.
3. **`.env.example` is stale.** It documents neither the session, mailer nor app-URL variables,
   and now also misses the six added here. The full table is in `apps/server/README.md`
   ("Configuration for authentication"); the root file is outside this change's ownership.
4. **`SessionRepository`, `MagicLinkRepository` and their in-memory doubles changed.** The ports
   in `packages/application/src/ports/persistence.ts` had to gain `findByTokenHash`, `touch`,
   `listForUser`, `deleteAllForUserExcept` and `supersede`, and `SessionRow` gained
   `tokenHash` and `lastSeenAt`. `packages/application/src/test-support/in-memory-repositories.ts`
   and its test follow the ports mechanically. Nothing else in that package changed.

## Deliberate design notes

- **The session row keeps its `id`.** Hashing could have replaced the primary key, but
  `document_locks.holder_session_id` and the new management routes need a name for a session
  that is safe to hand out. Keeping an opaque row key and adding `token_hash` beside it gives
  both, and makes the migration expand-only.
- **The dummy hash is a composition-time value, not a lazy cache.** See fix 5: building it on
  first use would put a measurable cost on one request, on the very path whose timing the fix is
  about, and would leave mutable state in a security module that nothing can reset.
- **The breached-password check fails open.** A third party being down must not stop people
  creating accounts. The audit event is what stops "fails open" from meaning "silently absent".
- **Backoff, not lockout.** A lockout is a weapon pointed at the victim. The window doubles for
  a key that keeps failing and always recovers, and both the address and the account are counted
  so neither a spray nor a brute force gets a free run.
- **The CSRF policy for headerless clients is written down**, in `plugins/csrf.ts` and above,
  because it is the one place where a reasonable reader could expect the opposite answer.
