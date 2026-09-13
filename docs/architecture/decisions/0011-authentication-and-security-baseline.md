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
- **Uploads**: size limits, content type determined by sniffing not by the client's header, images re-encoded, SVG sanitised, everything served from the blob store with `Content-Disposition` and a separate origin or path prefix that never executes.

### Abuse resistance

- Rate limits on sign-in, sign-up, magic link, reset, and share-link use, per account and per source address, with exponential backoff rather than hard lockout so an attacker cannot lock a victim out.
- Audit events for authentication outcomes, permission changes, share-link creation and use, exports, and administrative actions, without secrets or full tokens in any log line.
- **No full token appears in any log line the application writes**, including the URL a request line echoes and the URL a not-found response repeats back: a capability URL carries its token in the path, so it is redacted before either is written. A capability URL remains visible to whatever sits in front of the application — a reverse proxy, a CDN, a corporate egress log — which is a property of putting a capability in a URL rather than something the application can take back, so a share link is short-lived, revocable, and audited on every use instead.
- Secrets come from the environment or a mounted file, never from the repository; the container image holds none.

### Supply chain and process

- `pnpm audit` and a licence check run in CI; production dependencies are pinned by the lockfile; build scripts run only for allow-listed packages.
- A threat model for the platform is written in R12 and revisited when a new surface (public sites, live blocks, integrations) is added.
- Security fixes follow `SECURITY.md`; the review checklist in `docs/security/checklist.md` is part of the definition of done for any change touching auth, sessions, permissions, rendering, uploads, or outbound requests.

## Alternatives considered

- **JWTs in the browser.** Rejected: revocation and rotation are harder, and nothing here needs stateless tokens.
- **CSRF tokens.** Rejected in favour of `SameSite` plus fetch-metadata and origin checks, which are simpler and no weaker for a same-origin application.
- **Password rules and rotation.** Rejected per NIST: they reduce security by pushing users to predictable patterns; breached-password checks and length do more.
- **Passkeys deferred to enterprise.** Rejected: they are cheaper to add now than to retrofit and are the current best practice for consumer and workforce sign-in alike.

## Consequences

- The M1 auth implementation is reviewed against this ADR before M2 ships; gaps become tracked findings, not accepted debt.
- The Markdown renderer gains the sanitiser before any rendered content is served.
- The outbound HTTP client with SSRF protection is built once, before the first integration.
