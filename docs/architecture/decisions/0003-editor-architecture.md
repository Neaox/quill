# ADR-003: Editor architecture

**Status:** Accepted (confirmed by research R3, `docs/research/r03-editor.md`)
**Date:** 2026-09-12
**Related:** quill-plan.md section 17; ADR-002, ADR-004, ADR-021; decision D9

## Context

The review draft named "Quill" as the editor, which was ambiguous with the product name. If it meant Quill.js, that editor's flat Delta model, lack of core table support, absence of native Markdown, and accessibility record make it a poor fit for a Markdown-first, nested-block format with comments anchored to text. The editor also determines the path to real-time collaboration.

## Decision

- Build the editor on ProseMirror through TipTap. Schema nodes mirror mdast node types one to one, plus Quill directive blocks.
- CodeMirror 6 provides code blocks and an optional raw Markdown mode.
- The converter between mdast and the ProseMirror document is pure TypeScript in `packages/markdown`, covered by round-trip tests over a corpus of real documents. This converter is the real work and is the subject of research R3.
- Editor state is never persisted directly. Drafts store the AST (ADR-021).
- TipTap's paid extensions are not used. Comments, collaboration, and file handling are built on Quill's own data model.

### Converter requirements established by R3

The spike round-tripped a 19-document corpus through `markdown -> mdast -> ProseMirror -> mdast -> markdown`. The ProseMirror hop was lossless for every document; all remaining differences were remark's own serialisation normalisation, and output was idempotent for every document. The following are therefore requirements for `packages/markdown`, not options:

1. **Inline code must not exclude other marks.** TipTap's `Code` mark excludes every other mark, so a link containing inline code throws. Extend the mark with `excludes: ''` and keep a guard test asserting the code mark's exclusion list is empty, so a TipTap upgrade that reintroduces it fails loudly.
2. **Escape literal double colons.** `remark-stringify` writes `::` as `\::`, which re-parses as a text directive that was never written. Both colons are escaped through the `toMarkdown` extension's unsafe patterns.
3. **A raw mdast escape-hatch node.** Any mdast node the schema does not model is carried through as an opaque node and serialised back unchanged. Throwing on unknown input is forbidden.
4. **GFM tables serialise without pipe alignment** (`tablePipeAlign: false`). Measured on the corpus, aligned pipes rewrite four lines for a one-cell edit; unaligned rewrite one. This keeps Git diffs honest.
5. **Soft wraps collapse to spaces on first publish**, labelled as a formatting-only change per ADR-002. This is the one visible normalisation authors of hand-wrapped Markdown will see, once.
6. **Layout widths (ADR-027) are a block attribute in the editor** and a `:::wide` / `:::full` wrapper in Markdown. Lifting on load and re-wrapping on save was measured lossless in both directions.
7. **Task items are a `checked` attribute on ordinary list items**, because GFM allows checkbox and plain bullets in one list and TipTap's TaskList cannot express that.
8. **Mark nesting order is not preserved** (`**_a_**` versus `_**a**_`); a fixed serialisation order is used. Rendering is identical.

Two constructions the editor must prevent rather than the serialiser repair: multi-block table cells, and a layout wrapper around a link-reference definition.

`getSchema()` runs headless without a DOM, so `packages/markdown` may depend on `@tiptap/core` and remain framework-free. All packages in the resolved tree are MIT; no `@tiptap-pro` package is present. The TipTap major version is pinned because node names have moved between majors.

## Alternatives considered

- **Quill.js.** Rejected for the reasons in Context.
- **Lexical.** Rejected: weaker table and Markdown support, smaller extension ecosystem.
- **Slate-based editors (Plate).** Rejected: history of IME and Android reliability problems.
- **BlockNote.** Rejected: its block JSON is the source of truth, conflicting with ADR-002.
- **Milkdown (ProseMirror plus remark).** Closest alternative. Not chosen because its community and documentation are smaller than TipTap's, but its converter design is a reference for R3.

## Consequences

- Real-time co-editing later uses the standard ProseMirror plus Yjs path on the draft layer.
- Editor accessibility is tested on all supported browsers in every milestone that touches the editor.
- R3 confirmed this ADR. The remaining editor risk is accessibility of TipTap's table and list interactions with screen readers, which is tested in the first editor milestone. If that fails, TipTap is replaced but the converter is not, because the converter is pure TypeScript over mdast and a ProseMirror schema.
