# ADR-013: Frontend state architecture

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md section 18; research R13

## Context

React applications decay when server data, URL state, and client state are mixed in component state and synchronised with effects. The review draft set out rules; this ADR makes them a decision.

## Decision

- **Server state** lives in TanStack Query. **URL state** lives in TanStack Router. **Shared client state** lives in TanStack Store only where genuinely needed (editor session, cross-component UI). **Local UI state** lives in React state.
- **Domain and application logic** is plain TypeScript in packages, imported by the web app, and tested without rendering.
- Custom hooks encapsulate React-specific behaviour only.
- `useEffect` is used to synchronise with external systems (DOM APIs, editors, observers, sockets). Deriving values, handling user actions, and orchestrating business operations do not use effects. Effect chains and state-as-command-bus are forbidden.
- The web app talks to the server only through the generated OpenAPI client.

## Alternatives considered

- **Redux or Zustand as the primary store.** Rejected: most state is server or URL state, which Query and Router handle better; a general store invites putting server state in it.
- **A full-stack framework owning data loading.** Deferred to R8, which decides the SSR path for public pages; the authenticated app remains a single-page app.

## Consequences

- Dependency rules forbid the web app from importing infrastructure packages.
- Code review asks of every effect: which external system does this synchronise?
