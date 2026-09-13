# ADR-022: Comment anchoring model

**Status:** Proposed, pending research R7
**Date:** 2026-09-12
**Related:** quill-plan.md section 13; ADR-002, ADR-004, ADR-015; decision D11

## Context

Inline comments must follow the text they refer to through edits made in the editor and through edits made outside Quill in a synced repository, without writing anything into the Markdown.

Products fall into two families. Confluence, Outline, Notion, and Google Docs store a comment mark inside the document model, which is robust inside their editor but is why none of them export comments to Markdown. Hypothesis and the W3C Web Annotation model store selectors outside the document and re-anchor by fuzzy matching, which survives external edits but can orphan.

## Decision

- Threads live in Postgres. Each anchored thread stores a **selector**: exact quote with prefix and suffix, the AST path, the character range, and the published revision hash it was created against. Unanchored page-level threads are always allowed.
- In the editor, threads render as ProseMirror **decorations**, not marks, and are mapped through edits during the session. On publish, selectors are recomputed and stored.
- When a revision arrives from outside the editor, a **re-anchoring pass** matches quotes against the new content. Threads that cannot be placed are shown as orphaned with their original quote and can be re-attached by a user.
- Comments are never written into Markdown and are not part of Markdown export. A JSON export exists.
- Because every thread records a revision hash, the later review workflow attaches threads to a proposed change without migration.

## Alternatives considered

- **Block IDs written into the Markdown.** Rejected: violates portability and pollutes diffs for Git users.
- **Marks in the document model only.** Rejected: fails on external edits and would have to be serialised somewhere.
- **Page-level comments only.** Rejected: inline comments are table stakes for review.

## Consequences

- R7 measures the re-anchoring failure rate over real edit histories and tunes the matching strategy.
- Orphaned comments are a normal, visible state, not an error.
