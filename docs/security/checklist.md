# Security review checklist

Part of the definition of done for any change that touches authentication, sessions, permissions, rendering, uploads, outbound requests, or configuration. The standard is ADR-011; this is the working list.

## Authentication and sessions
- [ ] Passwords hashed with Argon2id at or above the OWASP minimum; parameters stored; re-hash on sign-in when raised.
- [ ] Breached-password check on every new password; length 12 to 128; no composition rules.
- [ ] Magic-link and reset tokens: 256-bit random, stored hashed, single use, 15-minute expiry, bound to the email, superseded by newer tokens.
- [ ] Constant-shape responses for sign-up, sign-in, magic link, and reset regardless of account existence.
- [ ] Session ids 256-bit random, stored hashed; cookie `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`.
- [ ] Rotation on sign-in, privilege change, and credential change; absolute and idle timeouts server-side; revocation and "sign out everywhere".
- [ ] State-changing requests check `Sec-Fetch-Site` and `Origin`.
- [ ] OIDC: code flow with PKCE, `state` and `nonce` verified, issuer and audience validated.
- [ ] Passkeys: user verification required, credential ids stored with sign counts checked.

## Authorisation
- [ ] Every route authorises through the domain resolver on the server; no trust in ids from the client.
- [ ] Share-link tokens random and hashed; expiry, revocation, policy, audit.
- [ ] Administrative actions audited.

## Headers and transport
- [ ] Strict CSP with nonces; no `unsafe-inline` or `unsafe-eval`; `frame-ancestors` set.
- [ ] HSTS behind TLS; `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` set.

## Input, output, content
- [ ] All inputs schema-validated; unknown fields rejected.
- [ ] Rendered Markdown sanitised on the server before caching; external links `rel="noopener noreferrer"`.
- [ ] External links: `noopener` always; `noreferrer` off only on public pages and only per admin choice; `Referrer-Policy` never loosened (ADR-011, amendment of 2026-10-11).
- [ ] A link an administrator or a member wrote into a public page is held to an allowlist of schemes on save (`http`, `https`, a rooted path), with no userinfo in the authority, and escaped on render.
- [ ] Outbound requests through the shared client: host allowlist, private-range DNS check, redirect limits, timeouts, size caps.
- [ ] Open-web fetches (ADR-042) use the open-web client only, never the allowlisted one and never with a credential: public addresses on every hop, ports 80/443, one total time budget, media type checked before the body, the organisation's policy asked on every request (pages, redirects, oEmbed endpoints, images).
- [ ] Every outbound call has **one clock for the whole call** (name lookup, each redirect, and the body), not a timer that stops when headers arrive; a host that is chosen only by an operator (object storage, mail) still has a timeout.
- [ ] A read that anonymous visitors can trigger never causes an outbound request; work a person can cause is rationed per person, not only per host.
- [ ] A route that serves a stored file by hash serves only hashes that thing put there: the store is shared, and a hash is not a permission.
- [ ] Slow work on other people's servers does not share a lane with quick work of ours.
- [ ] Anything that parses or matches untrusted input has a bound on its cost: input length capped, no regular expression built from data, a measured worst case (nesting, repetition, backtracking), not just a correct answer.
- [ ] A native decoder of untrusted bytes runs in a child process with no environment, and its reply is validated as untrusted.
- [ ] Uploads: size limits, sniffed content type, images stripped to what displays them and refused when unreadable (no decoder on the server; ADR-011, amendment of 2026-09-13), SVG served only as a download and shown only through the renderer's SVG allowlist (ADR-036), except an organisation's emoji image, which is shown only as `<img>` and served behind a `sandbox` CSP (ADR-038); non-executing serving origin.
- [ ] Client-drawn content (Mermaid) moves its styles out of markup (adopted stylesheets, `style.cssText`) so the CSP needs no `'unsafe-inline'`; nothing drawn may add script, handlers or links.
- [ ] `Content-Disposition` per RFC 6266: an ASCII fallback and `filename*=UTF-8''…`, with the quote, backslash and semicolon removed from the fallback, and truncation by code point.
- [ ] Anything cached under a session revalidates rather than being immutable, and the conditional is answered **after** the authorizer runs, so a withdrawn grant is not a `304`.
- [ ] A refusal names only what the caller may see; what they may not is counted, never named.

## Abuse and observability
- [ ] Rate limits with backoff on auth and share-link endpoints.
- [ ] Audit events for auth outcomes and permission changes; no secrets in logs.
- [ ] Timing-safe comparisons for every secret.

## Supply chain
- [ ] `pnpm audit` clean or exceptions recorded; build scripts allow-listed; secrets outside the repository.
