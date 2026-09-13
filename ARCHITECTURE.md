# Architecture

This file is the short version. The full design is in [`quill-plan.md`](quill-plan.md), Part III, and each significant decision has an ADR under [`docs/architecture/decisions`](docs/architecture/decisions).

## Shape

```text
Browser:  React SPA (authenticated)      Public site (server-rendered HTML)
                    |                                |
Server:   Fastify — API, SSR, auth, background jobs
          Application layer -> Domain layer
                    |
Storage:  Postgres (system data)   Content store (Git engine, hidden)   Blob store   Search index
```

- **Document content** lives in the content store, a Git-compatible object engine used as a library. Users never see Git. Publish is the only write; every publish is a revision.
- **Everything else** (units, users, grants, drafts, locks, comments, share links, audit, outbox) lives in Postgres.
- **Attachments** live in a blob store (filesystem or S3-compatible).

## Layering

```text
UI -> Features -> Application -> Domain <- Infrastructure
```

| Layer          | Lives in                                                                              | May depend on                                                                      |
| -------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Domain         | `packages/domain`                                                                     | Nothing. No React, Fastify, Drizzle, or provider SDKs.                             |
| Application    | `packages/application`                                                                | Domain, and interfaces it declares (content store, search, blob store, providers). |
| Infrastructure | `packages/content-store`, `packages/search`, `packages/providers`, server persistence | Domain and application interfaces. Implements them.                                |
| Server         | `apps/server`                                                                         | Application, infrastructure. Routes call application services only.                |
| Web            | `apps/web`                                                                            | Domain types, the generated API client, `packages/ui`. Never infrastructure.       |

These rules are enforced by `pnpm lint:deps` (see `.dependency-cruiser.cjs`).

## Rules that keep rewrites away

1. Documents are identified by a UUID in front matter, never by path.
2. The application layer speaks `ContentStore` vocabulary (documents, revisions, diffs), never repositories, trees, or refs.
3. Drafts are separate from published content. Publish is a domain command.
4. The `public` principal and scope-based grants exist from the first milestone.
5. Organisational units are a tree, not fixed levels.
6. Events go through the transactional outbox; indexing, notifications, sync, and webhooks are consumers.
7. Every draft, comment, and lock records the revision hash it relates to.
8. Provider-specific types stop at the provider boundary.

## Frontend

React renders; it is not the architecture. Server state in TanStack Query, URL state in TanStack Router, shared client state in TanStack Store only when needed, local UI state in React. Business logic is plain TypeScript in packages and is tested without rendering. `useEffect` synchronises with external systems and nothing else.

Routes are files. Everything under `apps/web/src/routes` is compiled by `@tanstack/router-plugin` into the generated, committed `routeTree.gen.ts`, so reading that directory is reading the URL space. Four rules hold it together: authentication is checked once, in `_authenticated/route.tsx`'s `beforeLoad`, and nowhere else; a shell is a **layout route** — `w/$workspaceSlug/route.tsx` renders the header, the icon rail and the navigation sidebar once, and the workspace home, every document, and the editor render inside its `<Outlet />`, along with their pending, error and not-found states, so no page builds chrome of its own and nothing flashes on navigation (presentation mode opts out with the `_` suffix, because the whole screen is the document); data is loaded by the route that needs it, through the same `*QueryOptions` factories in `lib/api` that its components read with, so the first render already has it; and URL state is search params (ADR-013), validated by the route that owns it. A document's address is a reference — `<title-slug>-<short key>` (ADR-035) — built by one helper in `lib/routing` and canonicalised by the route's loader, never assembled by a component. Code splitting is the plugin's `autoCodeSplitting`; loaders stay in the critical path by design.
