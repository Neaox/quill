# ADR-004: Internal document AST

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md section 16; ADR-002, ADR-003; research R2

## Context

Editing, rendering, search indexing, validation, export, comment anchoring, and interactive features all need a structured view of a document. If each builds its own, they drift.

## Decision

- The remark AST (mdast), extended with Quill directive nodes, is the single working representation of a document. It is produced by the `unified`/`remark` pipeline in `packages/markdown`.
- The editor converts to and from it (ADR-003). The renderer, search indexer, validator, exporters, and comment anchoring consume it.
- Drafts persist the AST as JSON. Published content persists Markdown (ADR-002). The AST is never the durable format.
- AST paths are stable enough to serve as one component of comment selectors (ADR-022).

## Alternatives considered

- **Using the editor's document model as the shared representation.** Rejected: it couples every consumer to the editor library and breaks when the editor changes.
- **HTML as the intermediate representation.** Rejected: loses Markdown structure and directive semantics.

## Consequences

- `packages/markdown` is a dependency of both the server and the web app and must stay framework-free.
- Every Markdown extension is defined once as an mdast node type with a parser, serialiser, renderer, and degradation rule.
