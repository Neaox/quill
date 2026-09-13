# ADR-011: Authentication and security baseline

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md sections 14, 23, 25; ADR-012, ADR-021, ADR-025, ADR-032, ADR-033

## Context

Authentication and security have to meet current practice, not the practice of the tutorials most code is copied from. The references this ADR follows are OWASP ASVS 5.0, the OWASP Cheat Sheet Series (authentication, session management, password storage, CSRF, forgot password), NIST SP 800-63B for password and authenticator rules, and the WebAuthn Level 3 specification for passkeys. Where they disagree with older habits, they win.

## Decision

### Identity and credentials

- **Passkeys (WebAuthn) are a first-class sign-in method**, not a later add-on: discoverable credentials with user verification, resident on the platform authenticator or a security key, registered from account settings and offered on the sign-in screen alongside email. They arrive in M3 with OIDC, ahead of the enterprise SAML and SCIM work, because they are the modern default for a new product.
- **Passwords** follow NIST 800-63B: minimum 12 characters (the platform's own floor), maximum 128, every printable Unicode character allowed, no composition rules, no periodic rotation, and every new password checked against a breached-password corpus through the HIBP k-anonymity range API with a local fallback list when that service is unreachable. Hashing is **Argon2id** with at least 19 MiB memory, 2 iterations, and parallelism 1 (the OWASP minimum), parameters stored with the hash and re-hashed transparently on sign-in when they are raised.
- **Magic links and reset links**: a 256-bit random token from `crypto.randomBytes`, stored **hashed** (SHA-256) so a database read never yields a usable token, single use, bound to the email it was issued for, valid for 15 minutes, and invalidated by any newer token for the same purpose. The link carries the token only in the URL fragment or POST body where the flow allows, and consuming it requires the same browser or an explicit confirmation step, so a link opened by a mail scanner does not sign anyone in.
- **No account enumeration**: sign-up, sign-in, magic link, and reset always answer in constant shape and similar time whether or not the email exists.
- **Email verification** is required before a user can be granted anything beyond their own profile.
- **OIDC** sign-in uses Authorization Code with PKCE only, `state` and `nonce` checked, issuer and audience validated, tokens never stored in the browser.

### Enterprise single sign-on

- **OIDC covers the common providers in the first release.** Microsoft Entra ID (the identity service behind Microsoft 365 and Azure AD), Google Workspace, and Okta are all OpenID Connect providers, so one OIDC implementation with per-provider presets serves them: discovery from the issuer, Authorization Code with PKCE, `state` and `nonce`, signature verification against the provider's JWKS with caching and key rotation, issuer and audience checks, clock-skew tolerance. Presets add the provider-specific checks: for Entra ID the tenant is pinned (`tid` must match the configured tenant, and the issuer is the tenant-specific one, never the `common` endpoint for a single-tenant customer); for Google the hosted-domain claim (`hd`) must match the configured domain; for every provider `email_verified` must be true before an email is trusted.
- **Providers are presets, not modules.** There is exactly one OIDC implementation. A provider preset is a data object: an id and display name, an issuer template with the fields the administrator fills in (tenant, region and pool id, domain), any extra authorisation parameters, the claim checks that must hold (`tid`, `hd`, `email_verified`), where groups live in the token (`groups`, `cognito:groups`, a namespaced Auth0 claim), and how sign-out works when the provider deviates from RP-initiated logout (Cognito's hosted-UI logout endpoint, Auth0's `/v2/logout`). Presets ship for Microsoft Entra ID, Google Workspace, Okta, Auth0, Amazon Cognito, and a generic OIDC provider for anything discovery can describe; adding a provider is adding a preset and its tests, never a code path. The port the rest of the system sees is `IdentityProvider`: start a sign-in for an organisation with a return path, complete it from the callback, and receive a `FederatedIdentity` of issuer, subject, verified email, display name, and optional groups, plus the raw claims for the audit log. Session creation, linking, provisioning, and policy live above the port and are identical for every provider.
- **SAML 2.0** ships in the enterprise phase for providers that offer nothing else, behind the same `IdentityProvider` port, with signed assertions required, signed requests, and replay protection.
- **Identity, not email, is the key.** A federated account is stored as `(issuer, subject)`; email is an attribute that can change. On first sign-in the account is linked to an existing user only when the provider asserts a verified email that matches, and organisation policy allows linking; otherwise a new user is provisioned just in time. An organisation may require SSO for a verified email domain, which disables password and magic-link sign-in for those users while keeping passkeys and break-glass instance-admin access.
- **Home-realm discovery.** The sign-in screen offers "Continue with Microsoft" and "Continue with Google" when configured, and routes an entered email to its organisation's provider by verified domain.
- **Groups and provisioning.** Entra ID and Okta group claims, and Google Workspace groups through the Directory API, can map to Quill groups at sign-in for a first version; **SCIM** is the supported way to provision users and groups continuously and arrives with SAML in the enterprise phase (ADR-012's unit tree and nested groups are designed for it). A user removed at the provider is deactivated on the next SCIM event or, without SCIM, at the next sign-in or session expiry.
- **Sign-out and re-authentication.** RP-initiated logout ends the provider session when the provider supports it; OIDC back-channel logout is accepted so a provider-side sign-out revokes Quill sessions; sensitive actions can require `max_age`-bounded re-authentication.
- **Configuration** lives per organisation, entered by an instance administrator: issuer, client id, client secret stored encrypted with the instance key, tenant or hosted domain, allowed email domains, linking and provisioning policy, and group mapping. Nothing about a provider is hard-coded beyond its preset.

### Sessions

- Server-side sessions stored in Postgres, referenced by a 256-bit random id that is stored hashed; the cookie carries the id only.
- Cookie attributes: `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`. Non-secure cookies are permitted only when the app URL is plain `http://localhost` for development.
- **Rotation** on sign-in, on privilege change, and on passkey or password change; absolute lifetime 30 days and idle timeout 7 days, both enforced server-side; every session listed in account settings with revocation, and "sign out everywhere" revokes all.
- **CSRF**: `SameSite=Lax` plus, on every state-changing request, a check that `Sec-Fetch-Site` is `same-origin` or `none` and that `Origin`, when present, matches the app URL. There are no CSRF tokens to leak or forget; the app never issues cookies to cross-site contexts.

### Authorisation

- Every route authorises through the domain resolver (ADR-012) on the server; the client never decides. Object references are ids the resolver checks, so there is no route that trusts a workspace id from the path without checking membership.
- Share links are 256-bit random tokens stored hashed, with expiry, optional password (hashed like any password), revocation, workspace policy, and an audit row per use.
- Instance administration is a separate role, and privileged actions are audited.

### Transport and headers

- HTTPS is assumed at the edge; the app sets `Strict-Transport-Security` with a long max-age and `includeSubDomains` when it knows it is behind TLS.
- A strict **Content Security Policy**: `default-src 'self'`, script and style sources by per-response nonce for server-rendered pages, no `unsafe-inline` or `unsafe-eval` anywhere, `frame-ancestors 'none'` for the application and a per-site policy for published sites, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. Third-party embeds run in sandboxed iframes with an allowlist (ADR-009).
- `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` denying what the app does not use, `Cross-Origin-Opener-Policy: same-origin`.

### Input, output, and content

- Every request body, query, and parameter is validated by schema (TypeBox) before a handler runs; unknown fields are rejected.
- **Rendered Markdown is sanitised**: raw HTML in documents is passed through an allowlist sanitiser (rehype-sanitize with a schema that permits the elements and attributes the renderer itself emits, plus safe inline HTML, and strips scripts, event handlers, `javascript:` and `data:` URLs except images). Sanitisation runs at render time, on the server, before anything enters the render cache; the editor previews the same output.
- Links to other documents are id-based (ADR-031); external links get `rel="noopener noreferrer"`.
- **Server-side requests** (embed metadata, source references, live blocks) go through one outbound client with an allowlist of hosts per integration, DNS resolution checked against private and link-local ranges to block SSRF, redirects limited and re-checked, timeouts, and response size caps.
- **Uploads**: size limits, content type determined by sniffing not by the client's header, images re-encoded, SVG sanitised, everything served from the blob store with `Content-Disposition` and a separate origin or path prefix that never executes. See the amendment of 2026-09-13 for what "re-encoded" and "sanitised" became: images are stripped at the container level without a decoder, and SVG is refused.

### Abuse resistance

- Rate limits on sign-in, sign-up, magic link, reset, and share-link use, per account and per source address, with exponential backoff rather than hard lockout so an attacker cannot lock a victim out.
- Audit events for authentication outcomes, permission changes, share-link creation and use, exports, and administrative actions, without secrets or full tokens in any log line.
- **No full token appears in any log line the application writes**, including the URL a request line echoes and the URL a not-found response repeats back: a capability URL carries its token in the path, so it is redacted before either is written. A capability URL remains visible to whatever sits in front of the application — a reverse proxy, a CDN, a corporate egress log — which is a property of putting a capability in a URL rather than something the application can take back, so a share link is short-lived, revocable, and audited on every use instead.
- Secrets come from the environment or a mounted file, never from the repository; the container image holds none.

### Supply chain and process

- `pnpm audit` and a licence check run in CI; production dependencies are pinned by the lockfile; build scripts run only for allow-listed packages.
- A threat model for the platform is written in R12 and revisited when a new surface (public sites, live blocks, integrations) is added.
- Security fixes follow `SECURITY.md`; the review checklist in `docs/security/checklist.md` is part of the definition of done for any change touching auth, sessions, permissions, rendering, uploads, or outbound requests.

## Amendment, 2026-09-13: uploaded images are stripped, not re-encoded; SVG is refused, not sanitised

The uploads clause above asks for two things the attachments work did not build: images re-encoded and SVG sanitised. Everything else in the clause is built — the type is sniffed from the bytes and a mismatch refused, the cap is counted as the bytes arrive, the file is served from the blob store by hash with `nosniff`, a sandboxing policy, and `inline` only for images (`packages/application/src/use-cases/attachments.ts`, `media-types.ts`; `apps/server/src/routes/attachments.ts`). This amendment records why those two were not, and what stands in their place, so the gap is a decision rather than debt.

### What re-encoding is for, and what already covers it

The advice to re-encode uploaded images addresses three risks.

1. **Polyglot files**: a file that is a valid image and also valid HTML, script, an archive, or a program. The harm needs a consumer that reads the other half. Here the browser is told the sniffed type with `X-Content-Type-Options: nosniff`, so it will neither render the bytes as a page nor run them as a script; the response carries `Content-Security-Policy: default-src 'none'; img-src 'self' data:; object-src 'none'; sandbox`; a PDF is a download, never inline; and the plug-ins that once executed same-origin polyglots are gone from browsers. What remains is the platform being used to host a payload that someone downloads and uses elsewhere, which needs `edit` on a document, and is rate-limited and audited. The two places such a payload lives — after the end-of-image marker, and inside comment or text segments — are exactly what stripping removes.
2. **Decoder exploits**: a picture crafted against a bug in the reader's image decoder (libwebp's 2023 heap overflow is the canonical case). Re-encoding does not remove this risk; it moves it. The decoder would run on the server, in the process that holds the database and blob-store credentials and is updated at the operator's cadence, instead of in a browser's sandboxed, automatically updated renderer process; `sharp` bundles the same libwebp, libpng, libjpeg-turbo and libavif the browsers use, and was affected by the same bug. Nor can it close the risk: the Markdown sanitiser admits `data:image/*` URIs and the application's policy allows `img-src data:`, so a person who can edit a document can already hand every reader's decoder any bytes at all without an upload. Server-side re-encoding of uploads would add attack surface to the most valuable process without removing any from the least.
3. **Metadata**: EXIF (position, device and serial, timestamps, a thumbnail of what was cropped away), XMP, IPTC, comments, text chunks. Every reader with `view` receives all of it, and with public publishing (M3) that is everyone. This is real, it is the one risk on the list that re-encoding uniquely addressed, and it does not need a decoder.

Against that, re-encoding costs a large native dependency and its build matrix in a self-hosted image; a second lossy pass over a lossy original; and care for every case that must survive a re-encode — animation, colour profiles, wide gamut, HDR — each of which is a way to quietly change what an author uploaded.

### Decision

- **Uploaded images are rewritten at the level of their container, without decoding.** PNG chunks, JPEG segments, GIF blocks, WebP chunks and AVIF items are walked, and only the parts a decoder needs to show the picture are kept: pixels, palette, colour profile, transparency, dimensions, animation control and frames. EXIF, XMP, IPTC, comments, text and time stamps are dropped, and so is whatever follows the end-of-image marker. A picture the walker cannot read as its container is refused (`file_malformed`) rather than stored. What the platform stores is the picture as kept, and the size and hash it records are of that. PNG, JPEG and GIF are streamed; WebP and AVIF are rewritten from a buffer bounded by the upload cap, because their heads state their whole. The keep-lists are in `image-metadata.ts` and `image-metadata-avif.ts`, one per format, tested against files written by real encoders and decoded back with independent decoders. No dependency was added.
- **SVG is refused, not sanitised.** An SVG is a document — it can carry script, external references and CSS — and a sanitiser has to be right about all of it, for ever. Nothing in the product needs SVG upload yet. When a diagram or source-artifact feature does (plan section 11, R14), it arrives with its own decision and its own renderer; until then the refusal names SVG and suggests PNG.
- The checklist line for uploads reads accordingly.

#

## Alternatives considered

- **JWTs in the browser.** Rejected: revocation and rotation are harder, and nothing here needs stateless tokens.
- **CSRF tokens.** Rejected in favour of `SameSite` plus fetch-metadata and origin checks, which are simpler and no weaker for a same-origin application.
- **Password rules and rotation.** Rejected per NIST: they reduce security by pushing users to predictable patterns; breached-password checks and length do more.
- **Passkeys deferred to enterprise.** Rejected: they are cheaper to add now than to retrofit and are the current best practice for consumer and workforce sign-in alike.

## Implemented

**OIDC sign-in — 13 September 2026 (M3).** The Enterprise SSO section above is
implemented for OpenID Connect, in `apps/server/src/auth/oidc/` and
`apps/server/src/application/federated-sign-in-service.ts`, with presets for
Microsoft Entra ID, Google Workspace, Amazon Cognito, Auth0, and a generic
provider; Okta is described by the generic preset and gains a named one when
an instance asks for its group claim. Authorization Code with PKCE (`S256`)
only, `state` and `nonce` bound to a ten-minute `__Host-` cookie, discovery
and JWKS fetched through the SSRF-safe outbound client and cached with a TTL
and a rate-limited rotation re-read, the id token verified with `node:crypto`
against `RS256`/`ES256` and checked for issuer, audience, `azp`, expiry and
nonce, and then the preset's own claim checks (`tid`, `hd`). Identities are
stored as `(issuer, subject)` in a new `identities` table, and the linking
policy this ADR asks for is implemented: an identity attaches to an account
that already exists only when the provider asserts a verified email **and**
that account has already verified the same address for itself, which is what
stops a pre-registered account being handed to whoever the provider vouches
for; a per-provider `ALLOW_LINKING` flag turns linking off entirely; a link
revokes every other session that account holds, because attaching a second
way in is a privilege change. Just-in-time provisioning is governed by a
per-provider "sign-up via SSO allowed" flag, sessions are issued and rotated
through the existing session service, every outcome is audited without
tokens, and every failure answers the browser identically. Configuration is
per instance through `OIDC_PROVIDERS` and `OIDC_<ID>_*`, validated at boot,
with the two endpoints on their own flat per-address budget.

**The client secret migration — 13 September 2026.** `OIDC_<ID>_CLIENT_SECRET`
is resolved from the settings store's secrets (`setSecret` / `getSecret`,
envelope-encrypted under the `KeyProvider`'s instance master key, ADR-034) at
the moment of use — the token exchange — falling back to the environment
variable, read fresh at that same moment rather than held anywhere for the
length of the deprecation window, when the store holds nothing under
`oidc/<id>/client-secret`. An administrator runs
`pnpm --filter @quill/server secrets:set oidc/<id>/client-secret < /path/to/secret-file`
once — the command refuses a value given as a second argument rather than
accepting it, which is what would put it in shell history; boot then warns,
naming that command, for as long as the fallback is what makes a provider
work, and refuses to start when neither names a *readable* value: a row
whose master key this instance no longer holds is caught here too, not left
to fail at the next sign-in. `SMTP_PASS` moved the same way, to
`smtp/password`, resolved on each outbox send rather than once at process
start. The end of the fallback — when `OIDC_<ID>_CLIENT_SECRET` and
`SMTP_PASS` stop being read at all — is a later, separate change.

**A discovery document may move an endpoint to another host, on the issuer's
own scheme.** `auth/oidc/discovery.ts` requires every endpoint a discovery
document names to share the issuer's scheme but never required it to share
the issuer's *host* — Amazon Cognito really does host its token endpoint on a
different name from its issuer, which is why the check was written that way.
`e2e/sso.spec.ts`'s fake provider is the first thing to exercise that: its
`authorization_endpoint` is a literal `127.0.0.1` address, browser-reachable
with no DNS involved, while its issuer, token endpoint and key set stay on
its own fake hostname, reachable only through the loopback-aware client a
real browser never needs. This was already true of the implementation; it is
recorded here because this PR is the first thing to rely on it.

**Still to come on this ADR:** passkeys (WebAuthn), moving provider
configuration itself — not just its secret — from the environment to
per-organisation settings an administrator edits, "require SSO for this
verified email domain", routing an entered email to its organisation's
provider, group mapping at sign-in, RP-initiated and back-channel logout, and
SAML 2.0 with SCIM in the enterprise phase. (Microsoft Entra ID emits no
`email_verified` claim, so an Entra identity never links into an account that
already exists; whether a tenant-pinned Entra token's `email` may be trusted
without one is a decision for an administrator, and the configuration does
not make it by accident.)

## Consequences

- The M1 auth implementation is reviewed against this ADR before M2 ships; gaps become tracked findings, not accepted debt.
- The Markdown renderer gains the sanitiser before any rendered content is served.
- The outbound HTTP client with SSRF protection is built once, before the first integration.
