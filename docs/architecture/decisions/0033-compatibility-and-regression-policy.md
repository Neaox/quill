# ADR-033: Compatibility and regression policy

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md Parts IV and VI; ADR-002, ADR-005, ADR-014, ADR-017, ADR-024, ADR-028, ADR-029

## Context

The owner's direction: once M2 is in place there must be no regressions, though breaking changes are still allowed; once version 1 ships, everything must be backward compatible from that point on. A policy only holds if it is checked by machines, so this ADR states what each phase means and what enforces it.

## Decision

### Phase 1: from M2 until version 1. No regressions; breaking changes allowed with a path.

A regression is anything a user could do yesterday that they cannot do today, or that got slower or less correct, without a deliberate, documented decision.

- **The journey suite is the regression suite.** Every end-to-end journey listed in the plan for a shipped milestone runs on every pull request on all supported browsers and must pass. A journey is only ever added or deliberately retired; it is never weakened to make a change pass.
- **Every bug fix adds the test that would have caught it**, at the lowest layer that can express it.
- **Coverage never drops** below the thresholds in ADR-017, and the thresholds only move up.
- **Performance budgets** in plan section 31 are checked against a benchmark run on every pull request that touches a hot path; a budget miss is a failing check, not a note.
- **Breaking changes are allowed but never silent.** A breaking change to an API, a persisted format, or a behaviour needs: an ADR or changelog entry stating what breaks and why, a migration (data, configuration, or documentation) that takes existing installations across, and the journey suite updated in the same change. "Breaking" means the shape changed; it never means a capability was lost.

### Phase 2: from version 1 onward. Backward compatibility is a requirement.

- **Persisted formats are versioned and readable forever.** Markdown documents and front matter (ADR-005), directives (ADR-002), the content-store layout and trailers (ADR-014), theme documents (ADR-028), template declarations (ADR-029), and packed token ranges (ADR-030) each carry a version. Every reader accepts every version ever shipped; writers emit the current one. A document written by version 1 renders identically in every later version.
- **Database migrations are expand and contract.** A release only adds columns, tables, and indexes and backfills them; a later release removes what nothing reads any more. A release is always upgradeable from the previous one without downtime, and a downgrade by one version is always possible while the contract step has not run. Backup and restore (ADR-024) cover the version being restored.
- **The API is versioned by path and additive within a version.** Fields are added, never removed or retyped; a removal is a new version with the old one supported for a published period, at least twelve months. The OpenAPI description is diffed in CI against the last release and any non-additive change fails the build.
- **Configuration is additive.** Environment variables and settings gain defaults; a renamed setting keeps its old name working with a deprecation warning.
- **Deprecation is a process, not a removal.** A deprecated feature or field is marked in the API description, the changelog, and the interface; it keeps working for at least two minor versions or twelve months, whichever is longer; then it is removed in a major version with the migration shipped first.
- **Semantic versioning** for the product and the API. Until version 1, minor versions may break with a migration; after it, only a major may, and majors carry automated migrations for every persisted format.

### What enforces it

| Rule | Check |
|---|---|
| Journeys pass | Playwright suite on every pull request, four browser profiles |
| Coverage never drops | thresholds in `vitest.config.ts`, raised only |
| Performance budgets | benchmark step in CI on hot-path changes |
| Persisted formats readable forever | a **format corpus**: one fixture per version of every persisted format, read by every release's tests |
| Migrations are expand and contract | a migration lint that fails on drop, rename, or type change without a preceding contract marker; an upgrade test from the previous release's schema |
| API is additive | OpenAPI diff in CI against the last tagged release |
| Deprecations honoured | deprecated markers carry a removal version; a test fails if a removal lands before it |

## Alternatives considered

- **Best-effort compatibility.** Rejected: every documentation platform's users keep documents for years; a document that renders differently after an upgrade is the worst regression the product can have.
- **Freezing formats at version 1.** Rejected: formats must evolve; versioning with readers for every version gives evolution without breakage.

## Consequences

- The format corpus and the OpenAPI diff are built with M2, so the regression policy is enforced from the day it applies.
- Every persisted format gets a version field now, while it is cheap, and every reader is written as a dispatch on version from the start.
- Changelog discipline begins at M2: every user-visible change is a line, every breaking change is a section with its migration.
