# ADR-023: Public publishing and server rendering

**Status:** Proposed, pending research R8
**Date:** 2026-09-12
**Related:** quill-plan.md section 14; ADR-012, ADR-013; decisions D13, D14

## Context

Developer teams publish documentation to the world. Public pages must be crawlable, fast, and consistent with the authenticated reading experience. Share links need the same anonymous access path with a token.

## Decision

- A workspace or collection can be **published**: slug or path, branding, navigation, and a Viewer grant to the **public** principal.
- Anonymous requests to public routes receive **server-rendered HTML** produced from the same React reading components used in the application, cached by content hash and invalidated by publish events. Sitemaps, canonical URLs, robots rules, and Open Graph metadata are generated.
- Public search is scoped to public content and rate limited.
- **Share links** are tokens mapped to a grant with scope, role, expiry, optional password, revocation, creator, and audit. Workspace policy controls creation and maximum role.
- The authenticated application remains a single-page app.
- Open: whether server rendering is a Fastify-hosted React render or TanStack Start. R8 decides. The reading components are shared either way.

## Alternatives considered

- **Static site generation at publish time.** Attractive because publish is the only write, but complicates share links and permission changes. R8 evaluates it as a cache strategy rather than the architecture.
- **Client-rendered public pages.** Rejected: not reliably crawlable.

## Consequences

- The public principal and grants (ADR-012) must exist before M3.
- Custom domains are an open question (plan, Part VII).
