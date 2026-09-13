# ADR-002: Markdown as canonical document format

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md section 16; ADR-004, ADR-005, ADR-014; research R2

## Context

Documentation platforms tend to store content in a proprietary JSON or HTML model and offer Markdown as a lossy export. Quill's first users edit documentation in repositories as well as in the application, and portability is a founding principle.

## Decision

- Markdown (CommonMark plus GitHub Flavored Markdown) with YAML front matter is the durable, canonical representation of a document. It is what the content store holds and what Git sync exchanges.
- Extensions use directive syntax (`:::name`) and must degrade to readable content in any Markdown renderer. Mermaid is a fenced code block.
- Unknown front matter fields and unknown directives are preserved through parse and serialise. This is tested with property-based round-trip tests.
- Serialisation is deterministic. Re-serialising an unchanged document produces byte-identical output.
- Three fidelity levels are named: **byte-preserving** for documents never opened in the editor; **semantic-preserving** for documents that have been opened, where the first publish from the editor may normalise formatting once; **canonical** for all output Quill produces.
- Comments, locks, drafts, and interactive user state are never written into the Markdown.

## Alternatives considered

- **Proprietary JSON document model with Markdown export.** Rejected: lossy round trips, and Git users would be second-class.
- **MDX.** Rejected as the canonical format: it is not readable outside a JavaScript toolchain and breaks the degradation rule.
- **Byte-preserving fidelity for every document.** Rejected: incompatible with a rich editor; the named fidelity levels make the trade-off explicit instead.

## Consequences

- The editor must be built on an AST-to-Markdown converter with strong round-trip tests (ADR-003, ADR-004).
- Formatting-only changes are labelled in the diff view so Git sync does not produce noise.
- Features that cannot be represented in Markdown are either stored beside the document in Postgres or not built.
