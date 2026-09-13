# ADR-025: Backend runtime and HTTP framework

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md sections 7 and 8; decisions D2, D3, D4

## Context

The review draft specified the frontend stack in detail and no backend at all. The Markdown pipeline (remark) is JavaScript and must run on the server for indexing, export, and Git sync.

## Decision

- **Runtime:** Node 24 LTS, moving to Node 26 when it enters LTS in October 2026. Odd-numbered releases are never used. TypeScript runs natively through type stripping: `erasableSyntaxOnly` is enforced, relative imports use explicit `.ts` extensions, and there are no path aliases. The container image bundles for production; development runs plain `node`.
- **HTTP framework:** Fastify, with schema-validated routes that generate the OpenAPI description from which the web client is generated.
- **Database:** PostgreSQL, with Drizzle for schema and migrations.
- **Monorepo:** pnpm workspaces. `apps/server`, `apps/web`, and `packages/*` share one TypeScript configuration and one quality gate.
- **Type checking:** TypeScript 7 (native compiler). Tools that do not yet support its API receive their own TypeScript 6 through a pnpm override, removed when they catch up.

## Alternatives considered

- **Go or Rust server.** Rejected: two languages, and the Markdown AST would have to be reimplemented or run in a sidecar.
- **Hono.** Viable and fast; Fastify chosen for maturity under load, its validation and OpenAPI story, and its plugin ecosystem on Node.
- **Prisma.** Rejected in favour of Drizzle's SQL-first migrations and lighter runtime.
- **A bundler in the development loop.** Rejected: native type stripping removes the need.

## Consequences

- One language end to end with shared types.
- Enums, namespaces, and parameter properties are unavailable by policy.
- Node 25 is end-of-life and was never an option; the review discussion's reference to it is corrected here.
