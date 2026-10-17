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
- [ ] Uploads: size limits, sniffed content type, images stripped to what displays them and refused when unreadable (no decoder on the server; ADR-011, amendment of 2026-09-13), SVG served only as a download and shown only through the renderer's SVG allowlist (ADR-036), except an organisation's emoji image, which is shown only as `<img>` and served behind a `sandbox` CSP (ADR-038); non-executing serving origin.
- [ ] Drawings an extension claims (draw.io, ADR-043) reach the page only through the platform's renderings — the SVG allowlist or a same-origin `<img>` — with only the data attributes the extension's grant names; a draw.io file's embedded source (`content`) never reaches the page; `style` declarations are read only as the presentation attributes the allowlist would keep, and `light-dark()` only with a colour on each side.
- [ ] Compressed input is inflated with the cap given to the inflater itself (zlib `maxOutputLength`, a counted `DecompressionStream`), one budget per file, with element and page counts capped; a file past any limit is refused whole (ADR-043).
- [ ] An embedded editor (`packages/editor/src/embedded-frame`): messages accepted only from the configured origin **and** the frame's own window, and only in a schema-validated shape; messages posted only to that origin, never `'*'`; the frame's sandbox documented token by token; the CSP `frame-src` generated from configuration; the editor never on the app's own origin (refused at boot), and a third-party editor an explicit opt-in.
- [ ] A write over shared content names the version it edited and a newer one refuses it (`409`), never a silent overwrite.
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
