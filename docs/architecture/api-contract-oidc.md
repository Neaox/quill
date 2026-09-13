# OIDC sign-in API contract

The three routes single sign-on adds (plan §23, ADR-011; use case 38). The server implements them with TypeBox schemas, so the OpenAPI description and the generated client match this document; if the two disagree, the server's schema wins and this document is corrected.

Only the first is an API call in the usual sense. The other two are **browser navigations**: they answer `302` with a `Location`, never JSON, because the browser has to leave for the provider and come back carrying a cookie.

| Method and path | Session | Purpose | Answer |
|---|---|---|---|
| `GET /api/auth/oidc/providers` | none | What the sign-in page may offer | `{ providers: [{ id, displayName }] }` — `[]` on an instance with no providers |
| `GET /api/auth/oidc/:id/start?redirect=` | none | Begin a sign-in | `302` to the provider's authorization endpoint, `Set-Cookie: __Host-<slug>_oidc`, `Cache-Control: no-store`; `404 not_found` for an id nobody configured; `429 rate_limited` |
| `GET /api/auth/oidc/:id/callback?code=&state=` | none | Finish it | `302` to the return path with `Set-Cookie: __Host-<slug>_session`, or `302 /sign-in?error=sso`; `404 not_found`; `429 rate_limited` |

The two browser endpoints share one budget per source address — `OIDC_RATE_LIMIT_MAX`, 300 a minute by default — counted on their own limiter and **flat**, never doubling the way the password endpoints' window does. They are keyed only by address, so an office behind one NAT is a single key; and neither can be usefully brute-forced, because `start` mints a fresh secret every time and `callback` needs the cookie this browser was given. A completed sign-in clears the budget.

## What `start` sends

`response_type=code`, `client_id`, `redirect_uri` (`<APP_URL>/api/auth/oidc/<id>/callback`), `scope` (the configured scopes, space-separated, always including `openid`), `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`, plus whatever the preset adds — Google Workspace's `hd`, for instance. The preset's parameters are applied first, so a preset can never replace `response_type` or the PKCE challenge.

`state`, `nonce` and the PKCE verifier are 256 bits each from `crypto.randomBytes`, and they leave the server in exactly one place: a ten-minute `HttpOnly`, `SameSite=Lax`, `Path=/`, `__Host-` cookie that also carries the provider id and the checked return path. `redirect` is only ever used when it is a path inside this application; anything else — `//evil.example`, `https://…`, `/\evil.example` — becomes `/`, so a fresh session can never be handed to a page that is not this one. The same check runs again when the cookie is read on the callback, because the cookie is the browser's own and a browser may have edited it.

## What `callback` checks, in order

1. `error` in the query: the person cancelled, or the provider refused. Recorded, then refused.
2. The state cookie exists and names this provider.
3. `code` and `state` are both present.
4. The query's `state` equals the cookie's, compared in constant time.
5. The code is exchanged at the token endpoint, over the SSRF-safe outbound client, with `client_secret_basic` unless the provider publishes only `client_secret_post`. The exchange sends `code_verifier`, and a `3xx` from the token endpoint is a failure rather than a hop — following it would replay the client secret at a host nobody named.
6. The id token verifies against the provider's published keys (`RS256` or `ES256`, chosen from an allowlist rather than from the token). A `kid` the cached key set does not hold triggers one re-read of the key set, rate limited, and one more attempt.
7. `iss`, `aud` (and `azp` when `aud` names several clients), `exp`, `nbf`, `iat` — the last three with a minute of clock skew — and `nonce`.
8. The preset's own claim checks: Entra's `tid` must be the configured tenant, Google's `hd` the configured domain.
9. The identity is matched on `(issuer, subject)`. A first sign-in attaches it to an account that already exists only when the provider asserts a **verified** email *and* that account has already verified the same address for itself — and only when `OIDC_<ID>_ALLOW_LINKING` permits it at all. Where no account exists, one is provisioned, unless `OIDC_<ID>_ALLOW_SIGN_UP` is `false`.
10. A session is issued through the session service, rotating whatever the browser already held. A **link** additionally revokes every other session that account holds.

### Why linking needs both halves

An account here that has never verified its address is a claim, not an identity: anybody can sign up as `cto@acme.example` and never open the mail. If a federated sign-in linked into it, the real owner's first "Continue with Microsoft" would hand them the squatter's account — and the squatter would keep their password on it. So an unverified local account is refused (`unverified_local_account` in the audit log), and its owner verifies their email the ordinary way first.

Microsoft Entra ID emits no `email_verified` claim, so an Entra identity never links into an account that already exists: it matches by subject, provisions, or is refused. Somebody keeping a password account on the same address verifies it here first, and then the link is made.

## Failures are indistinguishable, deliberately

Every refusal from step 1 to step 9 answers the same way: the state cookie is cleared and the browser is sent to `/sign-in?error=sso`. There is no code, no message, and no difference in shape between "that state is not yours", "the provider refused the code", "this instance will not create an account for you" and "the address is not verified" — because a browser that could tell them apart is an account-enumeration oracle for every address in the directory (ADR-011).

What distinguishes them is the audit log: `auth.sso.started`, `auth.sso.succeeded`, `auth.sso.failed`, `auth.sso.linked`, `auth.sso.provisioned`. A row's target is `<issuer>#<subject>` (or the provider id, when there is no identity yet) and its metadata is the outcome and one line of detail; a failure's `reason` is one of `email_not_verified`, `unverified_local_account`, `linking_not_allowed`, `sign_up_not_allowed`, `state_missing`, `state_mismatch`, `callback_incomplete`, `provider_refused`, `provider_unavailable`, `token_exchange_failed`, `invalid_token`, `claim_rejected`. No row carries a code, a state, a nonce, a token, or a claim set.

## CSRF

`GET /api/auth/oidc/:id/callback` is exempt from the fetch-metadata and `Origin` checks by design, and exempt for free: `plugins/csrf.ts` runs only for state-changing methods, and a provider's redirect is a `GET`. It has to be — a redirect is a `GET` — and it is a top-level *cross-site* navigation, so `Sec-Fetch-Site` is `cross-site` and there is no same-origin `Origin` to match. The state cookie takes the check's place: nothing in the callback is believed unless this browser holds the secret this server minted for this attempt, which is login CSRF closed by the mechanism the specification itself prescribes. The exemption is written down in `plugins/csrf.ts` so nobody removes it by widening the hook to `GET`.

## The web app

The sign-in page reads `GET /api/auth/oidc/providers` and renders one **anchor** per provider — "Continue with Microsoft" — above the password form, styled as a button through `buttonClassName`. An anchor, not a button with a handler, because leaving for the provider is a top-level navigation that `fetch` cannot perform. A list that is empty, or that cannot be read at all, renders nothing: the page is then exactly the page it always was.
