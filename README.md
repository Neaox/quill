# Quill

**Markdown underneath. Beautiful on top.**

Quill is an open-source, self-hostable documentation platform. It combines a polished editor and reading experience with Markdown as the durable source, versioning that costs the author nothing, comments, share links, public publishing, and optional synchronisation with a Git repository.

> **Status: milestones M0–M2 built, pre-release.** A team can sign in, organise units, workspaces, collections, and nested documents from the interface, write with autosave and locking, read in light and dark at readable addresses, present a document full-screen, and publish, compare, and restore revisions. Search, share links, public publishing, comments, and Git sync (M3–M4) are not built yet; nothing has shipped. The plan, decisions, build order, and a maintained status table live in [`quill-plan.md`](quill-plan.md).

## Quick start

Requirements: Node 24 (LTS), pnpm 11, Docker.

```bash
pnpm install
pnpm db:up                        # Postgres and MinIO via Docker Compose
pnpm --filter @quill/server seed  # two accounts, two workspaces, real documents, and three templates
pnpm dev                          # server on :3000, web on :5173
```

The seed is idempotent, so running it again changes nothing. It prints the
sign-in details when it finishes:

```text
email:    admin@example.com
password: admin-password-change-me

email:    writer@example.com
password: writer-password-change-me
```

Change both passwords before anyone else can reach the instance.

### End-to-end tests

```bash
pnpm exec playwright install      # once
pnpm test:e2e                     # starts the API and web dev servers, and seeds, itself
```

`pnpm db:up` still needs to be running first; from there `pnpm test:e2e`
needs nothing else done by hand. Playwright's `globalSetup`
(`e2e/support/global-setup.ts`) seeds a fresh database before any test
runs, and its `webServer` config starts the API server (`:3000`) and the
web app (`:5173`) for the run — there is no need to also have `pnpm dev`
running.

## Commands

| Command                                                | Purpose                                              |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `pnpm dev`                                             | Run the server and web app with hot reload           |
| `pnpm check`                                           | The full local quality gate. CI runs exactly this.   |
| `pnpm format` / `pnpm format:check`                    | oxfmt                                                |
| `pnpm lint`                                            | oxlint, including the project rules in `tools/oxlint-plugin` (brand literal, Tailwind 4 spellings, effect reasons, …) |
| `pnpm lint:deps`                                       | Architectural dependency rules (dependency-cruiser)  |
| `pnpm typecheck`                                       | TypeScript across all packages                       |
| `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` | Vitest                                               |
| `pnpm test:e2e`                                        | Playwright; seeds the database and starts both servers itself (run `pnpm exec playwright install` once) |
| `pnpm build`                                           | Production build of the apps                         |
| `pnpm rename`                                          | Rewrite the product name/slug/scope in one pass; see [`docs/operations/renaming.md`](docs/operations/renaming.md) |
| `pnpm --filter @quill/server seed`                     | Fill a local database: an admin and a writer, two units, two workspaces, twelve documents, three templates |
| `pnpm --filter @quill/server export-openapi`           | Write the API description from the routes into `packages/api-client/openapi.gen.json` |
| `pnpm --filter @quill/api-client generate`             | Regenerate the typed client from that description     |
| `pnpm changelog:check` / `pnpm changelog:release <version>` | Validate changelog fragments in [`.changelog/`](.changelog/README.md), or assemble them into `CHANGELOG.md` |
| `pnpm check:bundle` | Gzip/brotli-measure each route's initial bundle against its budget; see [`docs/operations/bundle-budget.md`](docs/operations/bundle-budget.md) |

## Repository layout

```text
apps/server        Fastify API, public-site rendering, background jobs
apps/web           React application
packages/domain    Entities, value objects, rules. Pure TypeScript.
packages/ui        Design tokens, the reading grid, and accessible React primitives
packages/config    Shared TypeScript, lint, and format configuration
packages/*         domain, application, content-store, markdown, search, highlight, theme, ui, editor, api-client, brand, config
docs/product       Personas, use cases with acceptance criteria, and the surface map
docs/architecture  Architecture decision records
docs/research      Investigation write-ups
docs/operations    Deploy, backup, upgrade guides
docs/archive       Superseded documents kept for the record
docs/ideas         Ideas not on the roadmap, one document each, with a trigger for when to pick it up
e2e                Playwright journeys
spikes             Throw-away prototypes; deleted when their ADR is accepted
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the layering rules and [CONTRIBUTING.md](CONTRIBUTING.md) for how to work on Quill.

## Licence

[MIT](LICENSE).
