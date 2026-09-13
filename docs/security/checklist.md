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
- [ ] Outbound requests through the shared client: host allowlist, private-range DNS check, redirect limits, timeouts, size caps.
- [ ] Uploads: size limits, sniffed content type, images stripped to what displays them and refused when unreadable (no decoder on the server; ADR-011, amendment of 2026-09-13), SVG refused, non-executing serving origin.
- [ ] `Content-Disposition` per RFC 6266: an ASCII fallback and `filename*=UTF-8''…`, with the quote, backslash and semicolon removed from the fallback, and truncation by code point.
- [ ] Anything cached under a session revalidates rather than being immutable, and the conditional is answered **after** the authorizer runs, so a withdrawn grant is not a `304`.
- [ ] A refusal names only what the caller may see; what they may not is counted, never named.

## Abuse and observability
- [ ] Rate limits with backoff on auth and share-link endpoints.
- [ ] Audit events for auth outcomes and permission changes; no secrets in logs.
- [ ] Timing-safe comparisons for every secret.

## Supply chain
- [ ] `pnpm audit` clean or exceptions recorded; build scripts allow-listed; secrets outside the repository.
