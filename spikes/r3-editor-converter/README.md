# Spike R3 — editor and Markdown converter

**Question.** Can a converter between mdast and a ProseMirror document built from
TipTap's official (MIT) extensions round-trip real documentation with the
fidelity levels of ADR-002, including unknown front matter, unknown directives,
and the ADR-027 `:::wide` / `:::full` layout wrappers? Should ADR-003 be accepted
as written?

**Answer.** Yes, with three fixes that must go into `packages/markdown`. See
`docs/research/r03-editor.md` for the write-up; this directory is the evidence.

## Running it

Node 24, native TypeScript, no build step.

```bash
pnpm install --ignore-workspace

node run.ts                          # the fidelity table
node run.ts --layout-attr            # ADR-027 layout as a block attr, not a wrapper
node run.ts --collapse-soft-breaks   # model a live editor collapsing source wraps
node run.ts --verbose                # print any document that differs semantically
R3_TABLE_PIPE_ALIGN=0 node run.ts    # unpadded GFM tables

node probes.ts        # the individual findings, each reproducible on its own
node diff-report.ts   # line-level diff of every document against its round trip
node schema-probe.ts  # the ProseMirror schema TipTap produces, headless
node tiptap-probe.ts  # proof that getSchema() needs no DOM
```

## Layout

```
src/pipeline.ts     unified/remark: markdown <-> mdast, with the canonical
                    serialisation profile and the "::" escaping fix
src/schema.ts       the ProseMirror schema, built with TipTap's getSchema()
                    from StarterKit + Table + List + Image + 10 Quill nodes
src/mdast-to-pm.ts  mdast -> ProseMirror
src/pm-to-mdast.ts  ProseMirror -> mdast
src/layout.ts       ADR-027: lift ":::wide" onto a `layout` attr and lower it back
src/compare.ts      mdast normalisation and comparison
corpus/             19 documents, written for this spike in the shape of real
                    READMEs, API references, runbooks, changelogs and ADRs
run.ts              the fidelity harness
```

## What the harness measures

For each document:

| column | meaning |
| ------ | ------- |
| `byte` | `md2 === md0`; nothing changed at all |
| `conv` | `md2 === md1`; the ProseMirror hop added nothing beyond what `remark-stringify` does on its own. This is the column that judges the converter |
| `sem`  | `parse(md2)` deep-equals `parse(md0)` after dropping positions |
| `idem` | `md3 === md2`; ADR-002's determinism requirement |

where `md1 = stringify(parse(md0))`, `md2` is the full round trip through
ProseMirror, and `md3` is a second pass over `md2`.

## Result

```
19 documents: 9 byte-identical, 19 converter-lossless (md2 === md1),
              18 semantically identical, 19 idempotent.
9/9 unknown-node preservation checks pass.
```

`--layout-attr` produces exactly the same numbers, so lifting `:::wide` onto a
block attribute and lowering it again is lossless.

The one document that is not semantically identical is `02-gfm-tables.md`, and
the cause is `mdast-util-gfm-table` padding a short row out to the header width
(`| a | b |` becomes `| a | b | |`). That is remark's serialiser, not the
ProseMirror hop, and it renders identically.

## The three things that must go into `packages/markdown`

1. **`Code.extend({ excludes: '' })`.** TipTap's inline-code mark ships with
   `excludes: '_'`, so it cannot coexist with any other mark; Markdown's
   ``[`parse()`](./api.md)`` and ``**`bold code`**`` then fail `Node.check()`.
   `addGlobalAttributes` cannot fix this and neither can `extendMarkSchema` —
   `getSchemaByResolvedExtensions` lets the extension's own `excludes` win. The
   mark has to be re-declared with `.extend()`.
2. **The `::` escaping plugin.** `remark-stringify` escapes a literal `::` in
   prose as `\::`, which re-parses as `:` plus a *text directive*. The serialiser
   invents a directive that was never there. Escaping both colons fixes it; the
   `unsafe` patterns must be pushed onto `toMarkdownExtensions` by a plugin
   because `remark-stringify` discards an `extensions` option.
3. **A `rawMdast` escape hatch.** Any mdast node type the schema does not know is
   carried through the editor as JSON on an atom node. Milkdown throws
   (`parserMatchError`) in the same situation; AGENTS.md rule 7 does not allow
   that.
