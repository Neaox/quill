# @quill/server

The Fastify HTTP server: persistence, authentication, the transactional outbox and job runner, and the content API. See `quill-plan.md` sections 7, 11, 12, 14, 22, 23, and 25, and ADR-012, ADR-014, ADR-015, ADR-021, ADR-025, ADR-029, ADR-030, and ADR-031 for the design this implements.

Business rules live in `packages/application`; this package composes them with a database, a content store, a Markdown pipeline, and HTTP. Routes call use cases and never a repository.

## Layout

```text
src/
  app.ts                 builds the Fastify instance (no listen) — routes only register when `deps` is supplied
  main.ts                composition root: wires config, database, mailer, job runner, and starts listening
  config.ts              environment loader (ServerConfig)
  dependencies.ts        AppDependencies — everything a route needs beyond pure logic
  errors.ts              AppError and factories; the { error: { code, message, details? } } shape

  infrastructure/
    content-store.ts        the ADR-014 store, filesystem or in-memory, chosen by configuration
    markdown/
      document-format.ts     the DocumentFormat port over packages/markdown
      highlighter.ts         the ADR-030 highlighter the renderer takes as an option
      required-sections.ts   which required sections are still empty (ADR-029)
    db/
      schema.ts           Drizzle schema for every table (plan §11)
      connection.ts       pg Pool + Drizzle handle factory
      migrator.ts         applies drizzle/*.sql under a Postgres advisory lock (plan §25)
      test-database.ts    one randomly named, migrated schema per integration test run
      rows.ts             requireRow() — narrows a possibly-undefined DB row without `!`
    repositories/         one file per repository port, plus unit-of-work.ts
    outbox/                consumer.ts (the interface), poller.ts (one FOR UPDATE SKIP LOCKED poll),
                           render-on-publish.ts (render on DocumentPublished), send-mail.ts
                           (deliver a queued message, then redact the row), acknowledge.ts
                           (a deliberate no-op for a type nothing acts on yet)

  jobs/
    job-runner.ts         schedules poller.pollOutboxOnce and the periodic jobs on one interval
    sweep-expired.ts      removes sessions past either clock and spent magic-link tokens

  scripts/
    export-openapi.ts       builds the app with in-memory fakes and writes packages/api-client/openapi.gen.json
    seed.ts                 idempotent local development data, created through the real use cases
    seed-documents.ts       the Markdown those documents are written in
    *-cli.ts                the composition roots those two scripts are run through

  shutdown.ts            the order the process closes in: job runner, then app, then pool

  auth/
    password.ts            createPasswordHasher(): the scheme registry composed, the re-hash
                           rule, and the dummy verify a missing account still pays for — built
                           once in the composition root, never lazily on a request
    password-scheme.ts     the registry of hash schemes, keyed by PHC identifier, one current
    password-schemes/      one file per scheme; argon2id.ts is the one in force
    email.ts               the canonical form of an address: every lookup and insert uses it
    breached-password-corpus.ts  the bundled list consulted when the remote corpus is down
    tokens.ts               single-use magic-link token generation and hashing
    session-token.ts        256-bit session tokens, their SHA-256, and a timing-safe compare
    breached-password.ts    the BreachedPasswordChecker port + the HIBP k-anonymity implementation
    mailer.ts               the Mailer port; dev-mailer.ts and smtp-mailer.ts implement it
    session-cookie.ts       httpOnly, SameSite=Lax cookie helpers
    oidc/
      presets.ts             the provider preset registry: issuer templates, claim checks, group claims
      provider-config.ts     OIDC_* -> OidcProviderConfig, validated at boot
      discovery.ts           discovery + JWKS through the outbound client, cached with a TTL
      id-token.ts            JWS verification (node:crypto) and every claim check
      pkce.ts                S256 code verifier and challenge
      oidc-provider.ts       the one IdentityProvider implementation
      registry.ts            the configured providers, built once per process
      state-cookie.ts        the ten-minute __Host- cookie one round trip is bound to
    rate-limit.ts           the backing-off limiter behind @fastify/rate-limit

  application/
    auth-service.ts         sign up/in/out, magic links, password reset and change, verification
    session-service.ts      issue, authenticate, rotate, revoke; the absolute and idle clocks
    audit.ts                the audit event vocabulary and the recorder
    authorization.ts        how a route asks the ADR-012 resolver what a request may do
    editing-service.ts      lock and draft operations, with `edit` re-resolved on every
                            heartbeat and every write
    federated-sign-in-service.ts  matching by subject, linking on a verified email,
                            just-in-time provisioning, session rotation, audit

  infrastructure/http/
    outbound-client.ts      the one SSRF-safe client every server-side fetch goes through

  plugins/
    error-handler.ts        maps every error to the consistent shape
    request-id.ts           honours/generates x-request-id
    session.ts               requireSession / requireVerifiedSession decorators
    csrf.ts                  Sec-Fetch-Site and Origin checks on every state-changing request
    security-headers.ts      @fastify/helmet: CSP with a per-response nonce, HSTS, and the rest
    rate-limit.ts            wires @fastify/rate-limit to the limiter, per address and per account
    openapi.ts                @fastify/swagger + swagger-ui (development only)

  routes/                  auth, auth-oidc, me, units, workspaces, collections, documents, drafts, locks
                           (+ health.ts)
                           document-schemas.ts holds the TypeBox shapes of the M2 content API
  test-support/             harness.ts (a whole server against a real database), tenancy-fixture.ts,
                           and fakes.ts; the in-memory repositories come from @quill/application/test-support

drizzle/                  generated SQL migrations (drizzle-kit) + meta/_journal.json
test-fixtures/            non-TypeScript fixtures for tests (kept out of src/ — see migrator.test.ts)
```

## Running migrations

Migrations are SQL files generated by `drizzle-kit` from `src/infrastructure/db/schema.ts` into `drizzle/`, applied by `src/infrastructure/db/migrator.ts` — never by `drizzle-orm`'s own migrator, because the generated SQL hardcodes `public` as the foreign-key schema, which `migrator.ts` strips so the same files work under any `search_path` (this is how integration tests isolate themselves, see below).

- **At startup**, `main.ts` calls `runMigrations(pool)` before the server starts listening. It takes a Postgres advisory lock first, so multiple server instances starting at once never race.
- **To add a migration**: change `schema.ts`, then run `pnpm --filter @quill/server exec drizzle-kit generate` from the repo root (or `pnpm exec drizzle-kit generate` from `apps/server/`). Commit the new file under `drizzle/` and the updated `drizzle/meta/_journal.json`.
- **Applied migrations** are tracked in a `schema_migrations` table (one row per applied tag), created on first run.
- The first migration also seeds a singleton `public` principal row (`principals.kind = 'public'`), so `GrantRepository`'s `ensurePrincipal` never has to race to create it — see the comment at the end of `drizzle/0000_*.sql`.

## Local development

```bash
docker compose up -d postgres   # from the repo root
pnpm --filter @quill/server dev
```

`DATABASE_URL` defaults to `postgres://quill:quill@localhost:5432/quill` (the same default `docker compose` and `.env.example` use). See `.env.example` for every variable `config.ts` reads, including `MAIL_DRIVER` (`dev` logs magic links to stdout instead of sending mail; `smtp` requires `SMTP_HOST`/`SMTP_FROM`).

## Auth flows (plan §23, ADR-011)

The standard is ADR-011; `docs/security/review-2026-09-12-m1-auth-closure.md` records which
test proves each of its requirements.

- **Email and password**: `POST /api/auth/sign-up`, `POST /api/auth/sign-in`. Passwords are 12
  to 128 characters of any Unicode with no composition rules, hashed with Argon2id at explicit
  parameters (`m=19456, t=2, p=1`) and re-hashed on sign-in when a stored hash is below them.
  Every new password is checked against the breached corpus; a corpus that cannot be reached
  fails open and writes an audit event.
- **No account enumeration**: sign-up always answers `202 {}`. An address that already has an
  account gets a "you already have an account" email rather than a different status code.
  Sign-in runs one verify whether or not the account exists, sign-up runs one hash on both
  branches, and an unknown address asking for a link still mints and hashes a token and writes
  an audit row of the same shape — so the timing does not answer the question either.
  `application/sign-in-timing.test.ts` proves it by counting, and again on the clock.
- **Addresses are normalised** (trimmed, lower-cased) at the service boundary for every lookup
  and every insert, with a unique index on `lower(email)` behind it: one mailbox is one
  account however it is spelled (`auth/email.ts`).
- **Magic links**: `POST /api/auth/magic-link { email }` always answers `202` and issues a
  *sign-in* link and nothing else; verification links come from sign-up and reset links from
  the reset endpoint, each with its own budget. It never creates an account.
  `POST /api/auth/magic-link/consume { token, confirm? }` signs in. Tokens are 256-bit, stored
  only as a SHA-256, single use under concurrency, expire after 15 minutes, and are
  *superseded*: issuing a newer one for the same user and purpose retires every older
  unconsumed one.
- **Links carry their token in the fragment**, never the query string, so it reaches no access
  log, no browser history, and no `Referer`; the web app reads it in the browser and posts it
  back. Every link request leaves a short-lived `__Host-<slug>_link` cookie behind, and
  consuming a link needs that cookie or `confirm: true` in the body — so a mail scanner or a
  link-preview bot that follows the link gets `403 confirmation_required` and spends nothing.
- **Mail is queued, not sent, on the request path.** A `MailRequested` outbox event is written
  in the same transaction as the token, and a consumer delivers it and then redacts the link
  out of the processed row. Waiting for SMTP on one branch and not the other was a measurable
  answer to "does this address have an account here?".
- **Email verification**: sign-up sends the link; `POST /api/auth/verify-email { token }`
  completes it. A verified address is required before creating or changing tenancy, documents,
  drafts, or grants (`app.requireVerifiedSession`); `/api/me` and the auth routes are not gated.
- **Password reset**: `POST /api/auth/password-reset/request { email }`, then
  `POST /api/auth/password-reset/confirm { token, newPassword }`, which revokes every session.
- **Password change** (signed in): `POST /api/auth/password { currentPassword, newPassword }`
  re-authenticates, revokes every other session, and rotates this one.
- **Sessions**: the cookie carries a 256-bit token from `crypto.randomBytes`; the `sessions` row
  stores its SHA-256 in `token_hash` and keeps an opaque `id` as the row key — what
  `document_locks.holder_session_id` and the management routes name. Two clocks are enforced
  server-side: absolute (30 days, `expires_at`) and idle (7 days, `last_seen_at`). Sessions
  rotate on sign-in, password change, reset, and privilege change.
- **Session management**: `GET /api/auth/sessions` lists them, `DELETE /api/auth/sessions/:id`
  revokes one, `DELETE /api/auth/sessions` signs out everywhere.
- **Sign out**: `POST /api/auth/sign-out` deletes the session and clears the cookie; idempotent.
- **Cookie**: `__Host-` prefixed and `Secure` when `APP_URL` is https, plus `HttpOnly`,
  `SameSite=Lax`, `Path=/`, and no `Domain`, and cleared with those same attributes — a
  browser will not honour a deletion that does not match. Plain http is accepted only for
  localhost. `SECURE_COOKIES` is deprecated and still honoured on a plain-http instance; on an
  https one, `SECURE_COOKIES=false` is ignored with a warning, and a `SESSION_COOKIE_NAME`
  without the `__Host-` prefix refuses to boot.
- **CSRF**: every POST/PUT/PATCH/DELETE must carry `Sec-Fetch-Site` of `same-origin` or `none`
  when it sends one, and a matching `Origin` when it sends one. A request with neither header is
  treated as a non-browser client and allowed only when it carries no session cookie —
  `plugins/csrf.ts` explains why.
- **Rate limiting**: sign-in, sign-up, magic link, password reset, password change, and lock
  takeover are limited per source address and per account, with a window that doubles for a key
  that keeps exhausting it rather than a lockout an attacker could aim at a victim. A link
  request counts against one bucket per *(account, purpose)*, shared across every route that
  could send that kind of mail; the endpoints that consume a token are limited by address. A
  correct sign-in clears both of its buckets, and the store forgets a key nobody has come back
  to, so it cannot grow without bound.
- **Audit**: every authentication outcome, session revocation, password change, privilege
  change, collection change, and rate-limit refusal writes an `audit_events` row carrying no
  token, password, or password hash. Privilege changes go through
  `application/auth-service.ts`'s `grantInstanceAdmin`, never `users.setInstanceAdmin`
  directly, because the repository call alone rotates nothing and audits nothing.
- **Single sign-on (OpenID Connect)**: `GET /api/auth/oidc/providers` lists what the sign-in page
  may offer, `GET /api/auth/oidc/:id/start` redirects to the provider, and
  `GET /api/auth/oidc/:id/callback` completes the round trip. Authorization Code with PKCE
  (`S256`) only, `state` and `nonce` minted per attempt and kept in a ten-minute `__Host-` cookie,
  the id token verified against the provider's published keys (RS256 or ES256) with issuer,
  audience, `azp`, expiry, `nbf`, `iat` and nonce all checked. See "Single sign-on" below.
- **Password schemes**: hashing is a registry keyed by the PHC identifier a stored hash already
  carries (`auth/password-scheme.ts`), with exactly one scheme current. Adding one is a file in
  `auth/password-schemes/` and an entry in the registry; retiring one is an operational step
  with a cost, written down in that module's doc comment — holders of hashes it wrote have to
  reset, because `verify` fails closed on a hash nothing registered recognises.

## Configuration for authentication

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_URL` | `http://localhost:$PORT` | Decides cookie `Secure`/`__Host-`, HSTS, and the `Origin` CSRF accepts |
| `SESSION_TTL_MS` | 30 days | Absolute session lifetime |
| `SESSION_IDLE_TTL_MS` | 7 days | Idle session lifetime, measured from `last_seen_at` |
| `SESSION_COOKIE_NAME` | `__Host-quill_session` or `quill_session` | Override the cookie name |
| `SECURE_COOKIES` | — | **Deprecated**; still honoured, warns on use |
| `AUTH_RATE_LIMIT_MAX` | `10` | Attempts per window, per key |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `60000` | The first window; it doubles for a key that exhausts it |
| `AUTH_RATE_LIMIT_MAX_WINDOW_MS` | `3600000` | Where the doubling stops |
| `BREACHED_PASSWORD_CHECK` | `true` | Set `false` for an air-gapped instance |
| `BREACHED_PASSWORD_RANGE_URL` | `https://api.pwnedpasswords.com/range` | The k-anonymity endpoint, and the outbound client's whole allowlist |
| `TRUST_PROXY` | — | A hop count, or the proxy addresses and CIDR ranges to believe. Unset, `X-Forwarded-For` and a supplied `X-Request-Id` are ignored |
| `NODE_ENV` | — | `production` stops the API description and Swagger UI being served, requires `DATABASE_URL`, and refuses `MAIL_DRIVER=dev` |
| `SEED_ALLOW_PRODUCTION` | — | `1` lets `pnpm seed` run under `NODE_ENV=production`, which it otherwise refuses |
| `DATABASE_RESET_ALLOW` | — | `1` lets `pnpm db:reset` empty a database whose name does not end in `_e2e` or `_test`; it never runs under `NODE_ENV=production` |

## Single sign-on (ADR-011)

One OpenID Connect implementation; a provider is a **data preset**, never a code path
(`auth/oidc/presets.ts`). Presets ship for Microsoft Entra ID, Google Workspace, Amazon Cognito,
Auth0, and a generic provider for anything discovery can describe. Adding one is adding an entry
to that registry and its row in the table-driven test.

**The flow.** `start` fetches the provider's discovery document through the SSRF-safe outbound
client, mints a `state`, a `nonce` and a PKCE verifier, leaves all three plus the return path in a
ten-minute `HttpOnly`, `SameSite=Lax`, `__Host-` cookie, and redirects with
`response_type=code`, `code_challenge_method=S256`, and the preset's own parameters. `callback`
compares the query's `state` with the cookie's in constant time, exchanges the code at the token
endpoint (`client_secret_basic` unless the provider publishes only `client_secret_post`), and
verifies the id token against the provider's JWKS. A token naming a `kid` the cached key set does
not hold triggers **one** re-read of the key set — key rotation — no more often than once a minute,
so invented key ids cannot be turned into outbound traffic.

**What is checked before a claim is believed** (`auth/oidc/id-token.ts`): the algorithm is chosen
from an allowlist of `RS256` and `ES256` rather than from the token, the key type must match the
algorithm, `iss` must equal the configured issuer exactly, `aud` must contain the client id (and
`azp` must name it when there are several), `exp`/`nbf`/`iat` are checked with a minute of skew,
and `nonce` must be this attempt's. Then the preset's own checks run as data: Entra's pinned `tid`,
Google's `hd`.

**Identity, not email, is the key.** A returning person is matched on `(issuer, subject)` in
`identities`, so changing their address at the provider moves nothing.

**Linking needs a verified address on both sides.** A first sign-in attaches the identity to an
account that already exists here only when the provider asserts a verified email *and* that account
has already verified the same address for itself. Without the second half, anybody could sign up as
`cto@acme.example`, never open the mail, and be handed the account the first time the real owner
pressed "Continue with Microsoft" — with their password still on it. An unverified local account is
therefore refused, not linked; its owner verifies their email the ordinary way and then the link is
safe. `OIDC_<ID>_ALLOW_LINKING=false` turns linking off entirely for a provider, which is ADR-011's
linking policy: that provider then signs in only identities it has already been linked to, and
provisions new accounts. A successful link **revokes every other session that account holds** —
attaching a second way in is a privilege change. Where no account exists, one is provisioned,
subject to `OIDC_<ID>_ALLOW_SIGN_UP`. The session is issued through the same session service as
every other sign-in and rotates whatever the browser already held.

**Microsoft Entra ID does not emit `email_verified`.** That is Entra's choice, not a gap here: with
no such claim the platform reads "not verified", so an Entra sign-in never links into an account
that already exists — it matches by subject, or it provisions a new account, or it is refused when
`ALLOW_SIGN_UP` is off. Somebody who already has a password account on the same address and wants
to keep it should verify that address here first and then sign in with Entra, which links. The
alternative — trusting a tenant-pinned Entra token's `email` without a verification claim — is a
decision for an administrator to make explicitly, and there is nothing in the configuration that
makes it by accident today.

**Every failure looks identical from the browser**: `302` to `/sign-in?error=sso`, no session, no
distinction between a bad state, a refused token, an unverified address and an instance that will
not provision. The reason is in `audit_events` (`auth.sso.started`, `auth.sso.succeeded`,
`auth.sso.failed`, `auth.sso.linked`, `auth.sso.provisioned`), and no row carries a code, a state,
a nonce or any part of a token. A failure row's `reason` says which check refused it —
`email_not_verified`, `unverified_local_account`, `linking_not_allowed`, `sign_up_not_allowed`,
`state_mismatch`, `token_exchange_failed`, and the rest.

**The two endpoints have their own budget**, `OIDC_RATE_LIMIT_MAX` (default 300 per minute per
source address), counted on their own limiter and **flat** — it never doubles the way the password
endpoints' window does. They are keyed only by source address, so an office, a school or a
carrier-grade-NAT customer is one key, and ten a minute between all of them would lock the building
out of single sign-on on a Monday morning. They also cannot be usefully brute-forced: `start` mints
a fresh secret every time and `callback` needs the state cookie this browser was given, so a flood
buys an attacker nothing but their own traffic. The budget exists to bound the outbound traffic a
stranger can make this server produce, and a completed sign-in clears it.

**No JWT library.** Verification is `node:crypto`: `createPublicKey({ format: 'jwk' })` plus
`crypto.verify`, with `dsaEncoding: 'ieee-p1363'` for ECDSA because JWS carries `r || s` where
Node defaults to DER. The mistakes a library exists to prevent — algorithm confusion, `alg: none`,
a public key used as an HMAC secret — are closed by construction here (there is no symmetric
branch at all) and each has its own test, which a dependency's internals would not have had in
this repository. See the module's doc comment.

**The callback is exempt from the fetch-metadata CSRF check by design**, and `plugins/csrf.ts`
says why: a provider's redirect is a top-level cross-site navigation, so there is no same-origin
`Sec-Fetch-Site` and no `Origin` to match. The state cookie takes its place.

### Configuration for single sign-on

| Variable | Default | Meaning |
| --- | --- | --- |
| `OIDC_PROVIDERS` | — | Comma-separated provider ids, in the order the sign-in page shows them |
| `OIDC_<ID>_PRESET` | `generic` | `entra`, `google-workspace`, `cognito`, `auth0`, `generic` |
| `OIDC_<ID>_CLIENT_ID` | — | Required |
| `OIDC_<ID>_CLIENT_SECRET` | — | The value, as a deprecated fallback. Stored as the secret `oidc/<id>/client-secret` (`setSecret`/`getSecret`, envelope-encrypted under the instance master key, ADR-034), resolved at the moment of use — the token exchange. Boot warns, naming the secret to set, when only this variable is present, and refuses to start when neither is |
| `OIDC_<ID>_DISPLAY_NAME` | the preset's | What the button says after "Continue with" |
| `OIDC_<ID>_SCOPES` | `openid email profile` | Space- or comma-separated; must include `openid` |
| `OIDC_<ID>_ALLOW_SIGN_UP` | `true` | `false` refuses a person with no account here instead of creating one |
| `OIDC_<ID>_ALLOW_LINKING` | `true` | `false` refuses to attach an identity to an account that already exists. Even when true, linking requires that account to have verified the address itself |
| `OIDC_RATE_LIMIT_MAX` | `300` | Requests per minute per source address, across both endpoints. Flat: the window never doubles |
| `OIDC_<ID>_EMAIL_CLAIM` / `_EMAIL_VERIFIED_CLAIM` / `_NAME_CLAIM` / `_GROUPS_CLAIM` | the preset's | Claim mapping overrides |
| `OIDC_<ID>_TENANT_ID` | — | `entra`: the directory the issuer and `tid` are pinned to |
| `OIDC_<ID>_HOSTED_DOMAIN` | — | `google-workspace`: sent as `hd` and checked on the token |
| `OIDC_<ID>_REGION`, `OIDC_<ID>_USER_POOL_ID` | — | `cognito` |
| `OIDC_<ID>_DOMAIN` | — | `auth0`, for example `acme.eu.auth0.com` |
| `OIDC_<ID>_ISSUER` | — | `generic`; must be `https`, with no query or fragment |

The redirect URI to register with each provider is `<APP_URL>/api/auth/oidc/<id>/callback`.

**`OIDC_DEV_LOOPBACK=true`** lets this process reach a provider that is really listening on
loopback — the in-process fake `e2e/sso.spec.ts` drives as its own process
(`scripts/fake-oidc-server-cli.ts`), or the same fake run by hand — despite the SSRF-safe
outbound client's blanket refusal of loopback and private addresses
(`auth/oidc/dev-loopback-client.ts`). Refused outright once `APP_URL` names anything but
loopback *or* under `NODE_ENV=production` — two independent signals, matching
`loadMasterKeyConfig`'s refusal of the all-zero master key rather than either alone — and
`e2e/sso.spec.ts` and `FAKE_OIDC_CLIENT_ID`/`FAKE_OIDC_CLIENT_SECRET` are the only things that
need it: those two are fixed, public, test-only values (`e2e/support/env.ts`), confined to
`e2e/**` and the fake provider's own process, never a real credential. It also lifts the generic
preset's issuer off `https` for exactly the same reason (`provider-config.ts`'s `checkIssuer`) —
nothing else does. The diversion itself is scoped to a provider whose own issuer is plain http
(`registry.ts`'s `isInsecureIssuer`): a real provider — Entra, Google, an on-prem Okta — is
always `https:` and is never diverted, even on a developer machine that also has one of those
configured.

## Outbound requests

`infrastructure/http/outbound-client.ts` is the single client every server-side fetch goes
through (ADR-011): a host allowlist, DNS resolution checked against loopback, private,
link-local, carrier-grade-NAT and cloud-metadata ranges, redirects capped and re-checked on
every hop, a timeout, and a response size cap applied as the body arrives.

It resolves, checks, and then **connects to the address it checked**, through a custom
`lookup` with `servername` kept so TLS still validates against the hostname — letting the
connection resolve a second time is how DNS rebinding walks past an allowlist. That is also
why the transport is `node:https` rather than `fetch`: `fetch` cannot express "connect here,
speak TLS for that name". IPv6 addresses are parsed to their sixteen bytes, so the IPv4-mapped,
NAT64 and 6to4 spellings of a private address get the IPv4 verdict rather than sailing past a
string-prefix check.

The transport and the resolver are parameters, so the unit tests drive the whole decision table
without a network. The breached-password checker is its first caller; it consults a small
bundled corpus (`auth/breached-password-corpus.ts`) whenever the remote range API cannot be
reached, so an outage is a narrower check rather than no check.

## Drafts and locks (ADR-021)

`PUT /api/documents/:id/draft` and the four lock endpoints (`/lock/acquire`, `/lock/heartbeat`, `DELETE /lock`, `/lock/takeover`) implement the ADR-021 API contract table exactly, including its status codes (`423 lock_lost`, `409 stale_version`, `401 session_expired`, `409 held`, `410 expired`, `409 taken_over`, `404 released`). `infrastructure/repositories/lock-repository.ts` and `draft-repository.ts` port the SQL validated by research R5 (`docs/research/r05-draft-locking.md`) unchanged, against the real schema instead of the spike's.

## Workspaces and collections

`GET /api/workspaces` lists the workspaces a request can reach, decided by the same resolver a
direct read uses, sorted by unit path and then by name, with the owning unit named beside each
one so a picker can group without a second request. Collections are created, renamed, listed and
deleted through `/api/workspaces/:id/collections` and `/api/collections/:id`: a rename leaves the
slug alone (documents are addressed by id, so nothing has to move), and a collection that still
holds documents refuses to be deleted, because removing the row would set `collection_id` null
and take every one of those documents out of the permission tree.

## The content API (M2)

`docs/architecture/api-contract-m2.md` is the contract; the TypeBox schemas in `routes/document-schemas.ts` are its implementation, and the OpenAPI description is generated from them.

- **Create** (`POST /api/workspaces/:id/documents`) makes a document and its first draft, blank or scaffolded from a published template (ADR-029). Template questions are answered in the request; conditions and `{{ answers.id }}` are resolved once, at creation, so nothing conditional ever reaches a revision.
- **Publish** (`POST /api/documents/:id/publish`) serialises the draft, strips authoring scaffolding, checks the front matter, and writes one revision through the content store. Checking warns and never blocks: an unfilled placeholder or an incomplete required section comes back in the response and the publish goes ahead. A stale `base` answers `409 { kind: 'merge-required', current, conflicts }`.
- **Read** (`/content`, `/rendered`, `/envelope`) splits the document in two, as ADR-031 requires: the body is a pure function of the revision and is cached by content hash under `(hash, RENDER_VERSION)`, while the envelope — permissions, lock, last publish, review, health signals — is fetched fresh. `/rendered` carries an `ETag` of the revision and the render version and answers `304` to a matching `If-None-Match`.
- **History, compare, restore** (`/history`, `/diff`, `/restore`) read the Postgres revisions index, which is the fast path and not a cache (ADR-014). Restore publishes the old content again as a new revision; history is never rewritten.
- **Navigation** (`GET /api/workspaces/:id/tree`) resolves the whole workspace's visibility in one pass with the domain's materialised resolution rather than one chain walk per document.

One outbox consumer keeps the reading view honest: `DocumentPublished` renders the new revision so the first reader never pays for it. Nothing is invalidated on a rename any more — the titles of the documents a body links to are part of the render input and therefore of the cache key, so a rename simply gives those bodies a new key (ADR-031). `DocumentRenamed` — emitted by a rename, and by a publish whose first heading changed the title — is still registered, acknowledged and no more, because the poller claims only registered types and an unregistered one would accumulate for ever (review finding H6).

## Configuration for content

| Variable | Default | Meaning |
| --- | --- | --- |
| `CONTENT_STORE` | `filesystem` | `filesystem` or `memory` (ADR-014) |
| `CONTENT_STORE_PATH` | `./data/content` | Where the filesystem backend keeps one bare repository per workspace |

A repository the platform writes is readable by the `git` command line: `git log` and `git show` work inside `data/content/<workspace-id>.git`.

## Settings and secrets (ADR-034)

`docs/architecture/api-contract-settings.md` is the contract.

- **Settings are files.** What an organisation configures — its name and logo, its theme, the default layout, the public site's navigation, and the policies (share links, public publishing, and how strictly the theme doctor reports) — is a YAML file in a **system workspace** of the content store, written through the same publish path documents are. Every change is a revision with an author and a change note; settings have history and restore like documents, and they move to another instance by being copied. A workspace's own file (`.quill/workspaces/<id>.yaml`) holds its layout override, when the organisation allows one.
- **Versions are a hard edge.** `version` is a literal and every object refuses fields it does not declare, so a release that adds one optional field writes documents the previous release refuses outright rather than reading leniently and dropping what it does not know (ADR-034). It is recoverable: an unreadable file is reported with its revision to an instance administrator, who overwrites it — or restores an earlier revision of it — through the API.
- **`logo` does not render yet.** `BlobStore` has no implementation on `AppDependencies` until the attachments work merges, so a saved hash resolves to nothing. The field is in the document from the start because adding it later would be a version bump for every instance.
- **Concurrent writes are refused, not merged.** A read answers with the revision it read at; a write states the revision it was based on. The adapter recovers the file's bytes at that revision and hands them to the content store as the expected value, so the compare-and-swap is over the file itself: two administrators configuring two different workspaces never collide, and two changing the same file get `409 settings_conflict` rather than a blend of both.
- **Secrets are rows, encrypted.** A secret entered in the product gets a data key of its own (AES-256-GCM), and that data key is wrapped by the instance master key, which is never in the database. Settings files reference a secret by name — `oidc/entra/client-secret` — and never by value, which is what makes a copied settings file complete and harmless. No route answers with a value; the audit trail records the name and the key id.
- **The environment is a one-release fallback, not a second source of truth.** `OIDC_<ID>_CLIENT_SECRET` and `SMTP_PASS` are resolved from the secrets store first, at the moment of use — the token exchange, an outbox mail send — falling back to the environment variable only when the store holds nothing for that name. Boot checks that *something* names a value, without ever opening a ciphertext to do it (`infrastructure/secrets/boot-validation.ts`), and warns once, naming the secret to set, whenever the fallback is what made the check pass.

| Variable | Default | Meaning |
| --- | --- | --- |
| `QUILL_MASTER_KEY` | the all-zero development key, with a warning | Base64, 32 bytes. Required on any instance whose `APP_URL` is not loopback, and under `NODE_ENV=production`; the development key is refused by value there |
| `QUILL_MASTER_KEY_PREVIOUS` | — | Comma-separated retired keys, kept so a rotation can unwrap |
| `MASTER_KEY_DRIVER` | `environment` | `environment` or `file` |
| `QUILL_MASTER_KEY_FILE` | — | Required with the `file` driver: one base64 key per line, current first. Must not be readable by anyone but its owner |
| `SECRETS_ROTATE_ACTOR` | — | The administrator a scripted rotation is audited against |

Entering a secret an administrator would otherwise type into the environment — the value comes
from a file or a variable already in the shell's memory, never typed or pasted onto the command
line itself, which is what would put it in `~/.bash_history`:

```bash
pnpm --filter @quill/server secrets:set oidc/entra/client-secret < /path/to/secret-file
# or, without a file:
read -rs SECRET && printf '%s' "$SECRET" | pnpm --filter @quill/server secrets:set oidc/entra/client-secret
```

The command refuses a second argument (the value must never be typed there) and refuses a
terminal stdin (it will not wait for you to type the value at a prompt it never offered), so
either mistake is a readable error rather than a hang or a silent leak. The value is read from
stdin, never from `argv` and never printed back — a command-line argument sits in shell history
and in this or any other process's list of running commands for as long as it runs, which is
exactly what a secret must not do, and `< file` or `read -rs` (its value never touches this
command's own argument list) are how the recipe above avoids that rather than merely asserting
it. Setting a name that already has a value replaces it, so rotating a client secret at the
provider is the same command run again; `SECRETS_SET_ACTOR` names the administrator it is
audited against, the same way `SECRETS_ROTATE_ACTOR` does for a rotation.

Rotating the master key: add the new key, keep the old one in `QUILL_MASTER_KEY_PREVIOUS`, restart, then

```bash
pnpm --filter @quill/server secrets:rotate
```

and drop the old key. It re-wraps every data key and never touches a ciphertext, so it costs the same whatever the secrets are; it is safe to run twice, because a secret already on the current key is not in the query; and each write is a compare-and-swap on the envelope it read, so a rotation running beside an administrator replacing a secret cannot leave the new value unopenable. A secret whose old key has gone is reported by name, and the command exits non-zero — that secret has to be entered again.

**Both layers of the envelope are bound to where they sit.** The value is sealed against `secret:v1:<name>` and the wrapped data key against `wrap:v1:<key id>`, as authenticated associated data. Somebody who can write the table but cannot read the master key therefore cannot move the SMTP password's row into the OIDC client secret's name and have the application use it as one.
## Attachments (ADR-011, ADR-034)

An attachment is a row in Postgres pointing at bytes in the blob store. The row says who uploaded what, to which document, under what name; the object is the bytes, addressed by their own SHA-256, so two documents carrying the same picture carry one object between them.

- **Upload** (`POST /api/documents/:id/attachments`, multipart, field `file` — any other field name is refused) needs `edit` on the document. The body is streamed: the size is counted as the bytes arrive and the type is read from the first bytes, so an oversized or unacceptable file is refused before the rest of it is worth receiving. The declared content type is checked against what the bytes actually are and a mismatch is refused; the allowlist is PNG, JPEG, GIF, WebP, AVIF and PDF. **SVG is refused**, and says so: an SVG is a document that can carry script, which is also why the renderer's sanitiser will not accept one. **Metadata is stripped** from JPEG and PNG uploads — the EXIF block a camera writes, with the coordinates and serial number in it — by a structural byte walk, before the hash, so the address is the address of what is served (ADR-011 amended 2026-09-13; `docs/security/review-2026-09-13-attachments.md`).
- **Read** (`GET /api/attachments/:id`) needs `view` on the document that owns it — the only thing that governs an attachment — and is a plain `GET` with the session cookie and nothing else, which is all a browser sends for `<img src="/api/attachments/…">` on the app's own origin. It answers with the sniffed content type, `Content-Disposition` per RFC 6266 (`inline` for an image, `attachment` for anything else, with both the ASCII fallback and the UTF-8 form of the name), `X-Content-Type-Options: nosniff`, a `Content-Security-Policy` of `default-src 'none'; sandbox`, and an `ETag` of the hash. Caching is `private, max-age=300, must-revalidate` rather than immutable: the bytes behind an id never change, but the permission to see them does, and the conditional request is answered *after* the authorizer runs, so a reader whose grant was withdrawn gets the refusal rather than a `304`.
- **Delete** (`DELETE /api/attachments/:id`) needs `edit`, marks the row removed, and leaves the object alone: the bytes may be another attachment's, and the blob store is a system of record (ADR-034). It is refused with `409 attachment_in_use` while any published document **in the attachment's own workspace** still points at its URL, which the link index answers (`render-document.ts` indexes the links of published heads). The refusal names only the documents the caller may `view` and counts the rest, so a workspace they have no grant on is never revealed by a delete.

Uploads are rate limited per signed-in person — 60 a minute by default, flat rather than backing off, and spent only by an accepted upload, because a refusal costs a few hundred bytes and no storage. Both writes are audited.

## Configuration for attachments

| Variable | Default | Meaning |
| --- | --- | --- |
| `BLOB_STORE` | `filesystem` | `filesystem` or `s3` (ADR-034) |
| `BLOB_STORE_PATH` | `./data/blobs` | Where the filesystem backend keeps one content-addressed file per object |
| `S3_BUCKET` | — | Required when `BLOB_STORE=s3` |
| `S3_REGION` | `us-east-1` | AWS needs one in the signature; MinIO wants one and ignores it |
| `S3_ENDPOINT` | — | Set for MinIO and every other non-AWS service (`http://localhost:9000`) |
| `S3_ACCESS_KEY_ID` | — | Required when `BLOB_STORE=s3` |
| `S3_SECRET_ACCESS_KEY` | — | Required when `BLOB_STORE=s3` |
| `S3_FORCE_PATH_STYLE` | true with an endpoint | `host/bucket` rather than `bucket.host` |
| `S3_PREFIX` | — | A key prefix, so one bucket can hold more than one instance |
| `ATTACHMENT_MAX_BYTES` | `26214400` | 25 MiB; counted as the bytes arrive, and capped at 256 MiB |
| `ATTACHMENT_RATE_LIMIT_MAX` | `60` | Uploads per person per minute, flat |

The filesystem backend fans out on the first four characters of the hash — `ab/cd/abcd…` — writes through a temporary file, and renames into place, so a crash mid-write leaves no truncated object under a hash that claims to be complete. The temporary file such a crash *does* leave is swept at startup, by age: anything in `tmp/` older than an hour, which is far longer than any upload the cap allows can take. The S3 backend speaks plain signed REST (`PUT`, `GET`, `HEAD`, `DELETE`) over `aws4fetch` rather than the AWS SDK; see `infrastructure/blob/s3-blob-store.ts` for why.

## The API description and the client

```bash
pnpm --filter @quill/server export-openapi   # routes -> packages/api-client/openapi.gen.json
pnpm --filter @quill/api-client generate     # openapi.gen.json -> the typed client
```

The description is built by registering the routes against in-memory fakes, so it needs no database and cannot drift from what the server accepts.

## Seeding a local instance

```bash
pnpm --filter @quill/server seed
```

Creates two accounts, both printed when it finishes: an instance administrator (`admin@example.com` / `admin-password-change-me`) and an editor who is not an instance admin (`writer@example.com` / `writer-password-change-me`, granted editor on Engineering through `createGrant`, the same use case a route would call).

It creates the unit "Acme" with the workspace "Engineering", and a second unit "Platform" with the workspace "Platform docs", so the organisational tree has real depth. Engineering gets the collections "Architecture", "Runbooks", "Decisions", and "Templates", and ten documents:

- An authentication design, a system overview, and a "Reading surface tour" showcase (every callout tone, both breakout widths, five fenced languages, a task list, and a footnote) in Architecture.
- A regional failover runbook and an on-call guide in Runbooks, published, plus "Incident review template (draft)" — created but deliberately never published, so it shows the reading view's not-published state.
- Two decision records in Decisions.
- Three built-in templates in Templates, the collection the New document dialog reads: "Architecture decision record" (a `:::when` section gated on whether alternatives were considered, wrapping a `:::repeat` for each option), "Technical design" (guidance blocks and optional sections for rollout and open questions), and "Runbook" (placeholder blocks and a `:::repeat` for steps).

Platform docs holds one short published document, "Platform team charter".

Every published document is created and published through the same use cases the API calls, so the revisions index, the render cache, and the link index end up exactly as a person doing the same work would leave them. Running the seed again changes nothing.

To start over, empty the database and the content store first:

```bash
DATABASE_RESET_ALLOW=1 pnpm --filter @quill/server db:reset   # drops everything in DATABASE_URL
rm -rf apps/server/data/content
pnpm --filter @quill/server seed                              # the next start migrates from nothing
```

`db:reset` creates the database if it does not exist and refuses one whose name does not end in `_e2e` or `_test` unless `DATABASE_RESET_ALLOW=1` says so. The Playwright run (`e2e/support/env.ts`) uses it on its own `quill_e2e` database before every run, which is why a development database never accumulates test workspaces.
