# Security and design review: `apps/server` after the M1 closure pass

- **Date:** 2026-09-12
- **Scope:** every production file under `apps/server/src`, the migrations, the domain scope-chain and permission code, and the use cases the routes call. Read-only; the suite was not re-run.
- **Method:** rubric in priority order: auth and session security to ADR-011 / OWASP ASVS / NIST 800-63B; route-layer authorisation; locking (ADR-021); config and secrets (ADR-034); persistence and transactions; outbound client SSRF; hidden state and first-call effects; patterns per `AGENTS.md`; test quality. Claims in `review-2026-09-12-m1-auth-closure.md` were verified in code, not taken on trust.
- **Outcome:** no critical findings. The three criticals from the M1 review are genuinely closed. Seven high, fifteen medium, and ten low findings follow, plus five closure-doc claims that are overstated. Each carries its fix; the closure of this review is recorded in `review-2026-09-12-m2-server-closure.md`.

## High

**H1. The flat workspace document list ignores document-scoped deny grants.** `routes/workspaces.ts:142-157` returns `documents.listByWorkspace` after a workspace-level `view` check only, while the tree route materialises effective permissions per document. A user denied `view` on one document still gets its id, slug, path, title, and status from the flat list. Fix: one code path decides visibility for both (the same materialise-and-combine pass).

**H2. Sign-up leaks account existence by timing.** `application/auth-service.ts:197-240`: the new-account branch runs an Argon2id hash; the existing-account branch returns without hashing. The closure test asserts equal status and body only. Fix: one hash-shaped unit of work on both branches, and a sign-up case in the timing test.

**H3. Password-reset and magic-link requests leak existence by timing and side effects.** `auth-service.ts:418-423` and `:340-348`: one `SELECT` for an unknown address versus supersede, insert, audit, and an awaited SMTP round trip for a known one. Fix: symmetric work (queue mail through the outbox rather than awaiting delivery on the request path; equivalent no-op work on the unknown branch).

**H4. Lock heartbeat and draft writes never re-check authorisation.** `routes/locks.ts:52-75` and `routes/drafts.ts:53-84` skip the authorizer by design; heartbeat extends `expires_at` indefinitely. A revoked editor keeps writing until their client stops. Fix: re-resolve `edit` on heartbeat and fail draft writes when the holder no longer has the capability.

**H5. `PATCH /api/documents/:id` writes `collectionId` and `parentId` through unvalidated and can brick the document.** `routes/documents.ts:320-351` authorises `manage` on the current location; the repository applies the patch verbatim; `parent_id` has no foreign key. A non-existent parent makes every later resolution fail with a 500, including the PATCH that could undo it. Fix: validate the destination (same workspace, caller holds `manage` there) and add the foreign key.

**H6. Unconsumed `DocumentCreated` outbox events starve the outbox.** `create-document.ts` emits `DocumentCreated`; `main.ts` registers consumers for `DocumentPublished` and `DocumentRenamed` only; the poller leaves an event with no consumer in the claim window, and the claim is `ORDER BY created_at LIMIT 10`. After ten creates nothing else is ever processed. Fix: a consumer or explicit no-op for every emitted type, and park events with no consumer.

**H7. Per-address rate limiting collapses to one bucket behind a proxy.** `plugins/rate-limit.ts:56` keys on `request.ip` and `trustProxy` is never configured, while ADR-011 assumes TLS at the edge. Fix: `trustProxy` from configuration, documented in `.env.example`.

## Medium

**M1.** The rate-limit store (`auth/rate-limit.ts:67-92`) grows without bound, keyed partly by attacker-supplied email; `reset` is called from nowhere but its test. Fix: evict ended windows; wire or delete `reset`.

**M2.** Magic-link and reset tokens travel in the query string (`auth-service.ts:120-127`) with no same-browser binding, against ADR-011. Fix: fragment carriage plus a short-lived `HttpOnly` "requested here" cookie checked at consume, with an explicit confirm step as the fallback.

**M3.** Email addresses are never normalised; `user-repository.ts:43-46` matches case-sensitively, so one mailbox can hold several accounts and the existing-account protection never triggers across casings. Fix: canonical lower-case form on every lookup and insert, backed by a unique index on the normalised column.

**M4.** The outbound client resolves and validates, then lets `fetch` re-resolve (`outbound-client.ts:139-189`): DNS rebinding. Fix: connect to the validated address via a custom `lookup` on an undici `Agent`, with `servername` set.

**M5.** IPv4-mapped IPv6 in hex form (`::ffff:7f00:1`), NAT64 and 6to4 bypass the private-range check (`outbound-client.ts:106-120`). Fix: parse to 16 bytes and apply the IPv4 verdict to embedded forms.

**M6.** The response size cap is applied after the whole body is buffered (`outbound-client.ts:167-177`). Fix: read in chunks and abort past the cap.

**M7.** `/api/auth/magic-link` is a second, separately-limited route to reset mail, and the `sign-in` purpose creates an account for any unknown address (`auth-service.ts:349-359`). Fix: one bucket per (account, purpose) across routes; restrict the public endpoint to `sign-in`; do not create accounts from magic-link requests.

**M8.** The token-consuming endpoints (`magic-link/consume`, `verify-email`, `password-reset/confirm`) have no rate limit, and reset reaches the breach lookup and an Argon2id hash. Fix: the address bucket on all three; reject before expensive work when the token does not resolve.

**M9.** `/api/openapi.json` is served unauthenticated in production (`plugins/openapi.ts:31`); the M1 closure marked finding 14 as passed but only the UI is gated. Fix: gate the JSON on the same flag; test asserts 404.

**M10.** No local fallback list for breached passwords; the check fails open when HIBP is unreachable, against ADR-011. Fix: a small bundled top-N corpus consulted whenever the remote verdict is unavailable.

**M11.** The privilege-change rotation path (`setInstanceAdmin` in the service) has no caller; the seed and the fixture set the flag directly, so neither rotates sessions nor audits. Fix: route every privilege change through the service when admin routes land; state the gap in the closure doc until then.

**M12.** Config boots on two unsafe production combinations: the default localhost `DATABASE_URL` and `MAIL_DRIVER=dev` (which logs credential-bearing links). Fix: refuse to boot under `NODE_ENV=production` in both cases, in the same shape as the plain-http refusal.

**M13.** The seed script has no production guard and hard-codes an instance-admin password that it overwrites on every run. Fix: refuse under production without an explicit opt-in; admin password from the environment with no default.

**M14.** `SECURE_COOKIES=false` and a custom `SESSION_COOKIE_NAME` can strip `Secure` and `__Host-` from an https deployment. Fix: ignore `SECURE_COOKIES=false` on https (warn, keep `Secure`); refuse a cookie name without the prefix on a secure instance.

**M15.** Expired sessions and spent magic-link rows are never removed, and `sessions.user_id` and `magic_link_tokens (user_id, purpose)` have no index though every revoke-all and supersede filters on them. Fix: both indexes and a periodic sweep.

## Low

- **L1.** `clearCookie` omits `secure`, so a `__Host-` cookie deletion is rejected by the browser and the stale cookie persists after sign-out. Pass the same attributes used when setting.
- **L2.** `document_locks.holder_session_id` has no foreign key and nothing releases a lock on session rotation or sign-out. Release the holder's locks when a session is revoked.
- **L3.** A client-supplied `x-request-id` of any length is adopted and echoed. Trust only from a configured proxy; cap length and charset.
- **L4.** Outbox `attempts` grows without limit with no dead-letter; the job runner overwrites `inFlight` each tick so `stop()` can return with a poll still running.
- **L5.** `unit-of-work.ts:62` defaults `ids` to a real generator, a second composition root inside infrastructure; the harness takes the default. Require injection.
- **L6.** Several routes (`documents.ts:335,359`, `workspaces.ts:64,105,116,154`, `units.ts:47-100`, locks, drafts) call repositories directly rather than an application service (rule 3), which is also why none writes an audit row.
- **L7.** The `inject-system-dependencies` lint rule matches only the member form `crypto.randomUUID()`, so the bare `randomUUID` import in `plugins/request-id.ts` and `db/test-database.ts` is invisible. Match the imported binding.
- **L8.** `lock-repository.ts:80-90`: when the conditional upsert matches nothing and the row is deleted by a concurrent release, `requireRow` throws and acquire answers 500 instead of retrying or returning "available".
- **L9.** The render-cache key is the content hash alone, shared across documents and tenants, while `markStale` addresses rows by `document_id`, so invalidation can mark the wrong entry. Resolved with the render-caching change (ADR-031 amendment).
- **L10.** Test quality: the browser client injects `sec-fetch-site: same-origin` into every request, so CSRF is effectively off in integration tests; the enumeration tests assert response shape only, which is why H2 and H3 survived.

## Closure-doc claims found overstated

1. **Finding 14 (Swagger, "PASS").** Only the UI is gated; the JSON is unconditional and the test asserts 200. See M9.
2. **Finding 4 and "constant-shape responses (PASS)".** Shape parity is proven; timing parity holds for sign-in only. See H2, H3.
3. **Finding 7 (breached passwords, "PASS").** The remote path is correct; the mandated local fallback does not exist. See M10.
4. **Rotation on privilege change.** The method is unreachable from the running app. See M11.
5. **Administrative actions audited ("PARTIAL").** Accurate, but there are no grant-management routes at all, so "permission changes are audited" has no live path behind it yet.

Findings 1, 3, and 10 of the M1 review were confirmed closed at the route and pipeline layers. The `sanitize-schema.ts` allowlist was reviewed separately in the markdown package review.

## What is solid

Sessions: 256-bit random token in the cookie, SHA-256 in the row behind a unique index, timing-safe confirmation with a length guard, both clocks enforced server-side with the injected clock, and a session past either clock is deleted rather than refused. Argon2id parameters pinned and asserted numerically; re-hash on sign-in is a real path; the dummy hash is built at composition time. The locking SQL matches ADR-021 clause for clause, including strict-less-than expiry and `FOR UPDATE` re-validation inside the draft-write transaction. The CSRF policy, including the headerless carve-out, has no browser-reachable bypass. The scope-chain code fails rather than guesses on a collection or ancestor outside its container, which is what keeps H5 a denial-of-service rather than a cross-tenant read. Configuration refuses plain http off loopback and derives cookie security from the app URL's scheme.

## Accepted risks

- **Dependency audit (2026-09-12):** `pnpm audit --prod` reports no known vulnerabilities. One moderate advisory (GHSA-67mh-4wv8-2f99, esbuild 0.24.2 and below) is reachable only through `drizzle-kit`'s development loader; it concerns esbuild's own development server, which this project never runs. Accepted until drizzle-kit drops the dependency; re-checked by `pnpm audit` in CI.
