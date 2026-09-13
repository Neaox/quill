# ADR-010: Search architecture

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md section 15; ADR-012; decision D10; research R9

## Context

Search must be fast, permission-aware, and available to self-hosters without extra services, while leaving room for a dedicated engine or semantic search later.

## Decision

- The first implementation is PostgreSQL full-text search: weighted `tsvector` columns (title A, headings B, body C), `pg_trgm` for fuzzy matching and typo tolerance, `ts_headline` for snippets.
- All search goes through a `SearchIndex` interface (`index`, `remove`, `query`) in `packages/search`. Application code never writes SQL for search.
- Permission filtering joins a materialised effective-permission table (ADR-012). Results never reveal titles the principal cannot read. Public search is scoped to public content and rate limited.
- Indexing is driven by `DocumentPublished` outbox events. A reindex command rebuilds the index from the content store.
- Meilisearch, Typesense, or a semantic index are later implementations of the same interface.

## Alternatives considered

- **Meilisearch from the start.** Rejected: an extra service for every self-hoster before the ranking requirements are known.
- **Search inside the application without an interface.** Rejected: guarantees a rewrite when the engine changes.

## Consequences

- R9 measures ranking quality and query latency against the performance budget (300 ms at 50,000 documents) and may adjust weights, not the architecture.
