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

## Consequences

- The quality gate fails on a coverage drop, which makes untested branches visible in review.
- Integration tests require Docker locally and services in CI; that cost is accepted.
