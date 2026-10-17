# ADR-017: Testing and coverage policy

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md section 27; CONTRIBUTING.md

## Context

The review draft asked for "100 percent coverage" without saying what that means per package. Full line coverage of UI code produces meaningless tests; full behavioural coverage of domain code catches real defects.

## Decision

- Development is test-first for meaningful behaviour.
- Coverage thresholds, enforced in `vitest.config.ts` and CI:
  - `packages/*` (domain, application, markdown, content-store, search, providers) and `apps/server`: 100 percent statements, branches, functions, and lines.
  - `apps/web`: 80 percent, with the gate being behavioural tests of interaction and accessibility rather than the number.
- Exclusions are rare, explicit in the configuration, reviewed in the pull request, and limited to entry points and generated code.
- Property-based tests are required for Markdown round-trip fidelity, permission resolution, draft locking, and comment re-anchoring.
- The pyramid: unit tests for domain, parsers, converters, and rules; integration tests for application services, persistence, content store, search, providers, and sync against real Postgres and a real bare repository; component tests for rendering, interaction, and accessibility; end-to-end tests for the release journeys listed in the plan, on Chromium, Firefox, WebKit, and mobile Safari emulation.
- If code is hard to test, the architecture is questioned before a test harness is built around it.

## Alternatives considered

- **A single global threshold.** Rejected: either too lax for the domain or a source of meaningless UI tests.
- **No numeric gate.** Rejected: coverage erodes without a gate.

## Amendment, 2026-10-17: the configuration now says what the policy says

The policy named which packages carry the full threshold and said full line coverage of UI code "produces meaningless tests", but `vitest.config.ts` applied the 100 percent threshold to a single glob, `packages/**`, which also caught the three UI packages: `packages/editor`, `packages/ui` and `packages/design-css`. The gate was therefore asking for what the policy argued against, and had gone red on branches of table-handle geometry, draw.io frame messaging and similar interaction code that behavioural tests in a browser are the right check for.

The thresholds now follow the policy. Every package that is not a UI surface (`api-client`, `application`, `brand`, `config`, `content-store`, `domain`, `highlight`, `markdown`, `search`, `theme`) and `apps/server` stay at 100 percent. The three UI packages join `apps/web` at an 80 percent floor, beneath the real gate, which is behavioural tests of interaction and accessibility (axe in component tests; `AGENTS.md` rule 14). A new package is non-UI unless it is listed with the UI surfaces in `vitest.config.ts`, so the default for new code is the stricter one.

Performance budgets (`*-budget.test.*`, `*-performance.test.*`) are measured where a budget means something: not under v8 coverage, which instruments every function, and not beside several hundred other test files. A coverage run leaves them out, and `pnpm test:budgets` runs them one file at a time without instrumentation as its own step of `pnpm check`.

## Consequences

- The quality gate fails on a coverage drop, which makes untested branches visible in review.
- Integration tests require Docker locally and services in CI; that cost is accepted.
