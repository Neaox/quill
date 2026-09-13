# ADR-005: Front matter schema

**Status:** Proposed, pending research R2
**Date:** 2026-09-12
**Related:** quill-plan.md section 16; ADR-002; decision D17

## Context

Document metadata (identity, title, owners, status, tags, review cycle, template-specific fields) must live with the document so Git sync and export carry it, while remaining validated and evolvable.

## Decision

- Metadata is YAML front matter validated by JSON Schema.
- A core schema is owned by Quill. Workspaces and templates may add fields under their own schemas. Schemas carry a version.
- The core schema includes `id` (UUID, required, never changed), `title`, `status`, `owners`, `tags`, `order`, and `review` (interval and last reviewed date). The exact list is settled in R2.
- Unknown fields are preserved and passed through untouched; validation warns but never discards.
- Schema forms in the UI are generated from the schema.

## Alternatives considered

- **Metadata only in Postgres.** Rejected: Git sync and export would lose it, and files would be meaningless outside Quill.
- **TOML or JSON front matter.** Rejected: YAML is the ecosystem convention (Jekyll, Hugo, Docusaurus, Obsidian).

## Consequences

- The identity rule of D17 has a concrete home.
- Externally synced files that lack an `id` are assigned one on import, which is a write back to the repository; R4 covers how that is done without surprising the author.
