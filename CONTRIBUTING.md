# Contributing to Quill

Thank you for considering a contribution. This document covers how the project works day to day. The design and roadmap are in [`quill-plan.md`](quill-plan.md).

## Setting up

```bash
pnpm install
pnpm exec playwright install   # once, for end-to-end tests
pnpm db:up                     # Postgres and MinIO
pnpm --filter @quill/server seed   # an admin, a workspace, and six real documents
pnpm dev
```

`pnpm check` is the local quality gate and is exactly what CI runs. Run it
before opening a pull request. It does not include `pnpm test:e2e`
(CI runs it as a separate job): Playwright's `globalSetup` seeds the
database itself and its `webServer` config starts both the API server and
the web app, so once `pnpm db:up` is running, `pnpm test:e2e` needs nothing
else — including no already-running `pnpm dev`. Run it too before opening a
pull request that touches anything a browser exercises.

## How we work

- **Test first.** Write the failing test, make it pass, refactor. Tests express behaviour, not implementation.
- **Coverage.** Domain, application, markdown, content-store, search, and server code are gated at full coverage. Exclusions are rare, explicit, and reviewed. Do not write meaningless tests to satisfy the number; write meaningful ones or question the design.
- **Layering.** Respect the dependency direction in [ARCHITECTURE.md](ARCHITECTURE.md). `pnpm lint:deps` will tell you if you have crossed a boundary.
- **Types.** Strict TypeScript, no `any`, no assertions to silence errors. The runtime strips types natively, so only erasable syntax is allowed: no enums, namespaces, or parameter properties.
- **React.** Business logic lives outside components. If a `useEffect` does not synchronise with an external system, it probably should not exist.
- **Markdown.** Every extension degrades to readable Markdown. Unknown front matter and unknown directives survive the round trip.
- **Accessibility.** Part of the definition of done, not a later phase.
- **Naming.** The product name is a code name until a final one is chosen; write it only via `@quill/brand`, never as a literal string. The `quill/no-brand-literal` lint rule (`tools/oxlint-plugin`) enforces this. See [`docs/operations/renaming.md`](docs/operations/renaming.md).
- **Clean, DRY, idiomatic, self-documenting.** Native TypeScript and platform features first (array methods, iterator helpers, `structuredClone`, `Object.groupBy`). `remeda` when native code would be clumsy; `rotery` for iterable and async-iterable pipelines. An owned utility is justified when the same shape appears three times, and it lives next to the concept it serves, not in a generic `utils` folder. lodash, underscore, and ramda are rejected by lint. Names explain what; comments explain why.
- **Patterns.** Complexity is managed with the named patterns in [`docs/architecture/patterns.md`](docs/architecture/patterns.md): ports and adapters, factory plus strategy, registries, observers, commands, reducers, `Result`, one composition root. Follow its naming so a reader recognises the shape from the name; do not add a pattern before the third instance earns it.
- **Performance.** Considered in every change, not bolted on. Lazy iteration for large collections, streaming for large transfers, batched database access, virtualised long lists, and a bundle budget for the web app. The budgets in `quill-plan.md` section 31 are the reference; measure before and after when touching a hot path.

## Definition of done

A change is complete when it has: correct layering, tests written first, meaningful coverage, type safety, accessibility, responsive behaviour, browser compatibility where UI is involved, loading, empty, and error states, performance considered, consistent visual treatment, and documentation where a user or operator needs it.

## Generated files

Anything a tool produces is named `<name>.gen.<ext>`, so it is obvious from the outside that it is generated: `schema.gen.d.ts` for the API client, `instrument.gen.css` for a theme's palette, `routeTree.gen.ts` for the router. Each carries a header naming the command that regenerates it, is never edited by hand, and is excluded from lint, format, and coverage by the pattern. A test asserts the committed output matches a fresh generation, so it cannot drift. Database migrations are the one exception: drizzle-kit names and journals them, and once generated they are reviewed and owned like any other code.

## Changelog

`CHANGELOG.md` is assembled from fragment files, not edited by hand. If your
pull request changes shipped behaviour under `apps/` or `packages/`, add a
file to [`.changelog/`](.changelog/README.md) describing it; CI fails a pull
request that touches those directories without one. Purely internal changes
(tests, CI, tooling, refactors with no observable effect) don't need a
fragment. See `.changelog/README.md` for the exact format, and run
`pnpm changelog:check` locally before opening the pull request. A maintainer
runs `pnpm changelog:release <version>` at release time to assemble
fragments into `CHANGELOG.md`.

## Architecture decisions

Significant decisions are recorded as ADRs in `docs/architecture/decisions`. Copy `0000-template.md`, take the next number, and open the ADR in the same pull request as the change it justifies. An ADR may be `Proposed`, `Accepted`, `Superseded`, or `Rejected`.

## Spikes

Exploratory code goes in `spikes/`. It is not linted, not covered, never imported by a package, and is deleted when its ADR is accepted.

## Pull requests

- Keep them focused. One concern per pull request.
- Describe what changed and why. Link the ADR or plan section if the change is architectural.
- The quality gate must be green.
- Commit messages: a short imperative summary line, a blank line, then the reasoning if it is not obvious.

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
