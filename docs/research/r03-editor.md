# R3 — Editor and Markdown converter

**Question.** Can a converter between mdast and a ProseMirror document meet the
fidelity levels of ADR-002 over real documentation, and should ADR-003
(ProseMirror through TipTap) be accepted as written?

**Time box.** 2026-09-12, one day. If the time box expired without a converter
that round-trips the corpus, ADR-003 would have been revised to a
CodeMirror-first editor with a rich preview, deferring the WYSIWYG surface.

## What was examined

Everything below was installed and run; nothing is taken from documentation.

| Package | Version | Licence |
| ------- | ------- | ------- |
| `@tiptap/core`, `starter-kit`, `pm`, `extension-table`, `extension-list`, `extension-image`, `extension-code` | 3.31.3 | MIT |
| `prosemirror-model` | 1.25.11 | MIT |
| `unified` | 11.0.5 | MIT |
| `remark-parse` | 11.0.0 | MIT |
| `remark-gfm` | 4.0.1 | MIT |
| `remark-frontmatter` | 5.0.0 | MIT |
| `remark-directive` | 4.0.0 | MIT |
| `remark-stringify` | 11.0.0 | MIT |
| `@milkdown/transformer`, `@milkdown/preset-commonmark` (read only, for Q6) | 7.22.1 | MIT |

The prototype is `spikes/r3-editor-converter/`: a converter in both directions, a
corpus of 19 documents, and a harness (`run.ts`) that prints the fidelity table.
Node 24 runs the TypeScript directly. The ProseMirror schema is not hand-written:
it is produced by TipTap's `getSchema()` from a real extension list, which works
with no DOM present (`tiptap-probe.ts` asserts `typeof document === 'undefined'`).

The corpus was written for this spike rather than copied, to avoid importing
other projects' licences, but each document is shaped after a real genre:
CommonMark basics, a GFM table page in the shape of the GFM spec's examples,
nested lists, GitHub-style task lists, an installation guide with code in list
items, fenced code including Mermaid, a README badge block of reference-style
links, a README header built from raw HTML `<div align="center">` and
`<details>`, front matter full of fields no schema knows, the ADR-027 layout
examples, callout/decision/leaf/text directives, unknown directives, an
esbuild-style README, a Stripe-style API reference, a Keep a Changelog file, a
page of inline edge cases, an SRE runbook, an ADR, and a page of escaping
hazards.

## Findings

### 1. The converter works, and the residual loss is remark's, not ProseMirror's

The harness separates two sources of change, which is the only way to judge the
editor fairly:

- `md1 = stringify(parse(md0))` — what `remark-stringify` does to the document on
  its own, with no editor involved.
- `md2 = stringify(pmToMdast(mdastToPm(parse(md0))))` — the full editor round trip.
- `md3` — a second pass over `md2`.

`conv` below is `md2 === md1`: the ProseMirror hop added nothing of its own.

| document | bytes | byte | conv | sem | idem | note |
| -------- | ----: | ---- | ---- | --- | ---- | ---- |
| 01-commonmark-basics.md | 740 | yes | yes | yes | yes | |
| 02-gfm-tables.md | 898 | no | yes | **no** | yes | short row padded to header width |
| 03-nested-lists.md | 717 | yes | yes | yes | yes | |
| 04-task-lists.md | 639 | yes | yes | yes | yes | includes a mixed checkbox/bullet list |
| 05-code-in-lists.md | 800 | yes | yes | yes | yes | |
| 06-code-fences.md | 741 | yes | yes | yes | yes | incl. Mermaid, nested fences, `meta` |
| 07-reference-links.md | 1094 | yes | yes | yes | yes | full, collapsed and shortcut references |
| 08-html-blocks.md | 861 | yes | yes | yes | yes | block and inline HTML, comments |
| 09-frontmatter-unknown.md | 902 | yes | yes | yes | yes | |
| 10-layout-directives.md | 891 | no | yes | yes | yes | table padding only |
| 11-callout-directives.md | 869 | no | yes | yes | yes | directive attribute quoting |
| 12-unknown-directive.md | 868 | no | yes | yes | yes | directive attribute quoting |
| 13-readme-style.md | 1300 | no | yes | yes | yes | table padding only |
| 14-api-reference.md | 1521 | no | yes | yes | yes | table padding only |
| 15-changelog.md | 1187 | yes | yes | yes | yes | |
| 16-inline-edge-cases.md | 1245 | no | yes | yes | yes | hard break, entities, escapes |
| 17-runbook.md | 1753 | no | yes | yes | yes | table padding, attribute quoting |
| 18-adr-style.md | 1373 | no | yes | yes | yes | table padding only |
| 19-escaping-hazards.md | 1384 | no | yes | yes | yes | escape normalisation |

**19 documents: 9 byte-identical, 19 converter-lossless, 18 semantically
identical, 19 idempotent.**

Idempotence — ADR-002's hard requirement — holds for every document in every
mode tested, including the modes below. Every document also produces a
ProseMirror document that passes `Node.check()` against the TipTap schema.

`conv` is `yes` for all 19. Every difference between a source document and its
round trip is a normalisation `remark-stringify` would have made without an
editor in the loop. The catalogue, from `diff-report.ts`:

| normalisation | example | renders differently? |
| ------------- | ------- | -------------------- |
| GFM table cell padding | `\| a \| b \|` → `\| a    \| b     \|` | no |
| short table row padded | `\| a \| b \|` → `\| a \| b \| \|` | no |
| directive attribute quoting | `{type=warning}` → `{type="warning"}`, `{id=D9}` → `{#D9}` | no |
| nested container fence length | `:::wide` → `::::wide` when it wraps a `:::` | no |
| hard break marker | two trailing spaces → `\` | no |
| GFM autolink literal | `https://x` → `<https://x>` | no |
| character references decoded | `&copy;` → `©`, `&lt;tag&gt;` → `\<tag>` | no |
| escape normalisation | `1\.` → `1.`, `\#tag` → `#tag`, `inside_a_word` → `inside\_a\_word` | no |
| inline code fence padding | `` `` a ` b `` `` → ``` ``a ` b`` ``` | no |

The single `sem` failure, `02-gfm-tables.md`, is the second row of that table:
`mdast-util-gfm-table` pads a row that has fewer cells than the header, so
re-parsing yields an extra empty `tableCell`. GFM renders a missing trailing cell
as empty, so the rendered table is identical; but the mdast is not, so the
harness reports it honestly rather than defining the difference away.

### 2. Unknown nodes survive (AGENTS.md rule 7)

`run.ts` asserts this rather than eyeballing it. All nine checks pass:

- Front matter comes back **byte-identical** for all three documents that have
  it, including a YAML comment, a complex key (`? key` / `: value`), preserved
  key order, an empty value, and quoting with interior whitespace. The
  `frontMatter` node carries the raw string; nothing parses or re-emits the YAML.
- Top-level directives deep-equal after the round trip for the unknown
  `:::timeline`, `:::experiment` (with a quoted attribute value containing a
  colon, a space and a slash), `::future-embed`, `:unknown-inline`, and
  `:::panel{#id .class}` shorthand.
- A wholly invented mdast node type (`somethingQuillHasNeverSeen`, with an
  arbitrary nested object payload) comes back deep-equal through the `rawMdast`
  escape hatch.

### 3. ADR-027 layout widths round-trip in both representations

Two representations were implemented and measured:

- **wrapper** — `:::wide` is a `containerDirective` node in the ProseMirror
  document.
- **attr** — `:::wide` is lifted away and each block it wrapped carries
  `layout="wide"`; on the way out, runs of adjacent blocks with the same `layout`
  are re-wrapped. This is what ADR-027 asks the editor to show: "the wrapper is
  not shown as a separate block".

Both give identical numbers: 9 byte-identical, 19 converter-lossless, 18
semantic, 19 idempotent. Lift-then-lower is lossless on this corpus.

One normalisation is inherent to the attr representation and should be accepted:
two adjacent `:::wide` blocks separated by nothing merge into one on the way out.
So does a `:::wide` that wraps blocks which cannot carry a `layout` attribute
(`frontMatter`, `definition`); the lift refuses those and leaves the wrapper in
place, which is why the mode is lossless rather than merely usually-correct.

### 4. Three defects that must be fixed in `packages/markdown`

Each is reproducible on its own with `node probes.ts`.

**(a) TipTap's inline-code mark excludes every other mark.**
`@tiptap/extension-code` ships `excludes: '_'`. The stock StarterKit schema
reports `code.excluded = link,bold,code,italic,strike,underline`. Markdown
disagrees: ``[`parse()`](./api.md)`` is a `link` around an `inlineCode` and
``**`bold code`**`` is a `strong` around one. Without a fix the converter
produces documents that throw `RangeError: Invalid collection of marks for node
text: link,code` from `Node.check()`.

Neither `addGlobalAttributes` nor `extendMarkSchema` can fix it:
`getSchemaByResolvedExtensions` spreads `extendMarkSchema`'s result *first* and
then lets the extension's own `excludes` field overwrite it. The mark must be
re-declared: `StarterKit.configure({ code: false })` plus
`Code.extend({ excludes: '' })`.

**(b) `remark-stringify` invents a directive from a literal `::`.**
Text `::not-a-directive because of the space` is serialised as
`\::not-a-directive …`. The `\:` consumes one colon and the remaining `:name` is
a valid *text directive*, so re-parsing produces a `textDirective` that the
author never wrote. This is an round-trip-unsafe escape, not a cosmetic one.

The fix is to escape both colons. `remark-stringify` discards an `extensions`
option (it overwrites it with `toMarkdownExtensions`), so the `unsafe` patterns
have to be pushed on by a tiny plugin:

```ts
function remarkEscapeDirectiveColons(this: Processor) {
  const data = this.data();
  const list = data.toMarkdownExtensions ?? (data.toMarkdownExtensions = []);
  list.push({ unsafe: [{ character: ':', after: ':' }, { character: ':', before: ':' }] });
}
```

Cost: a literal `::` anywhere in prose is written `\:\:`. Benefit: the output is
stable, which is what ADR-002 requires. Verified stable for `::x`, `:::wide`,
`::toc{}`, `:badge[x]{}`, and `3:2`.

**(c) Unknown node types need an escape hatch.** Milkdown throws
(`parserMatchError`) when no node spec matches. AGENTS.md rule 7 does not allow
that, so the schema carries a `rawMdast` atom whose single attribute is the
unmatched subtree as JSON.

### 5. Table padding is the largest source of first-publish diff noise

`remark-gfm`'s `tablePipeAlign` defaults to `true`, which pads every cell to its
column width. Measured on the corpus:

| setting | source lines changed on first publish | lines rewritten when one cell is edited |
| ------- | ------------------------------------: | --------------------------------------: |
| `tablePipeAlign: true` (default) | 75 / 897 | 4 of 4 |
| `tablePipeAlign: false` | 38 / 897 | 1 of 4 |

For a product whose documents are synced to Git and reviewed as diffs, padding
halves the readability of every table change. Byte-identity on the corpus is
unaffected (both settings give 9/19), because the corpus writes `| --- |`
delimiters and the unpadded serialiser writes `| - |`.

### 6. Milkdown, as a reference design (Q6)

`@milkdown/transformer` 7.22.1 is MIT and readable. Its shape:

- Each ProseMirror node/mark spec carries `parseMarkdown: { match, runner }` and
  `toMarkdown: { match, runner }`. The converter is co-located with the schema
  rather than living in two big switch statements. This matches ADR-004's "every
  Markdown extension is defined once as an mdast node type with a parser,
  serialiser, renderer, and degradation rule" better than the switch-based
  converter in this spike does, and it is the design worth copying.
- `ParserState` / `SerializerState` are stack machines (`openNode`, `next`,
  `closeNode`) over the mdast tree. The serialiser builds an **mdast tree** and
  then calls `remark.stringify` — the same two-stage approach used here.
- `#matchTarget` throws `parserMatchError` on an unmatched node. No escape hatch.
- `remarkMarker` is a direct precedent for "store formatting hints as node
  attrs": it reads the source at `node.position.start.offset` to recover whether
  emphasis used `*` or `_`, stores it as `node.marker`, and the mark schema
  carries a `marker` attribute. Writing it back needs custom `handlers` for
  `strong` and `emphasis` in `remark-stringify` — a bare `node.marker` is ignored
  (verified: `probes.ts` section D). Milkdown also overrides the `text` handler
  to stop remark encoding trailing spaces as `&#x20;`.
- `@milkdown/preset-commonmark` runs `remark-inline-links`, which **rewrites
  reference-style links into inline links at parse time**. Its `html` node is
  inline-only and an atom, so a block of raw HTML is not modelled as a block. Its
  `code-block` node keeps `lang` but drops `meta`. All three are losses Quill
  must not inherit, and the reason this spike models `definition`, `htmlBlock`
  and `codeBlock.meta` explicitly.

Conclusion: borrow Milkdown's *organisation* (parse/serialise co-located with the
node spec, stack-machine state, mdast-then-stringify), not its node set.

### 7. TipTap specifics (Q5)

**Headless.** `getSchema()` builds the whole schema in Node with no DOM, no
jsdom, and no editor instance. `packages/markdown` can therefore depend on
`@tiptap/core` and stay framework-free and server-usable, as ADR-004 requires.

**Extensions that map cleanly** — all MIT, all in the installed tree, none
paid:

| Node set item | Extension | Maps cleanly? |
| ------------- | --------- | ------------- |
| paragraph, heading 1–6, blockquote, thematic break, hard break | StarterKit | yes |
| emphasis, strong, strikethrough | StarterKit (`italic`, `bold`, `strike`) | yes |
| inline code | StarterKit `code` | **only after `excludes: ''`** |
| link | StarterKit `link` | yes, needs `title` + reference attrs added |
| image | `@tiptap/extension-image`, `configure({ inline: true })` | yes, needs reference attrs added |
| fenced code with language | StarterKit `codeBlock` (`language` attr) | yes, needs a `meta` attr added |
| ordered/unordered lists with nesting | StarterKit `bulletList`/`orderedList`/`listItem` | yes, needs `spread` (and `checked`, see below) |
| task lists | `@tiptap/extension-list` `TaskList`/`TaskItem` | yes, with one gap |
| GFM tables with alignment | `@tiptap/extension-table` | yes, needs `align` on the table node |

**Gaps found, all solvable:**

- `Code.excludes` — finding 4(a); the only one that needs `.extend()`.
- `TaskList` cannot express a GFM list where only *some* items are checkboxes,
  which is legal and appears in real issue checklists. Solved by also giving
  `listItem` a `checked` attribute (`null | true | false`) and using `taskList`
  only when every item is a checkbox. Round-trips byte-identically
  (`04-task-lists.md`).
- `listItem` content is `paragraph block*` and `tableCell` content is `block+`,
  but mdast list items may begin with a nested list and mdast table cells hold
  phrasing. Solved by inserting a paragraph marked `synthetic: true` and removing
  it on the way out.
- Multi-block table cells are expressible in ProseMirror and not in GFM. The
  converter flattens them and emits a warning; the editor should prevent them.

**Schema customisation is sufficient for directives.** `Node.create()` gives
`containerDirective` (`content: 'block+'`), `leafDirective` (`content:
'inline*'`), and `textDirective` (inline, `content: 'inline*'`), each with a
`name` attribute and a JSON `attributes` attribute. `Extension.addGlobalAttributes`
adds attributes to extensions we did not write — `layout` on fourteen block
types, `align` on `table`, `meta` on `codeBlock`, `title`/`referenceType`/
`identifier`/`label` on the `link` mark. The resulting schema is 28 nodes and 5
marks. The one thing `addGlobalAttributes` cannot do is change a non-attribute
spec field such as `excludes` or `content`; those need `.extend()`.

**Licensing.** Every installed package is MIT. No `@tiptap-pro` or
`@tiptap-cloud` package appears anywhere in the resolved tree, and none is needed
for this node set. The paid surface (Comments, AI, Collaboration/Cloud,
Drag Handle in v2, Table of Contents) lives in the `@tiptap-pro` scope on a
private registry, so accidentally depending on it is a visible event, not a
silent one. Version constraint observed: TipTap 3.x moved TaskList/TaskItem into
`@tiptap/extension-list` and folded Link and Underline into StarterKit; pin the
major and configure `underline: false` so the schema has no mark Markdown cannot
express.

### 8. Where fidelity is fundamentally impossible (Q4)

The important distinction: almost none of these are ProseMirror's fault. mdast
has already discarded the information before the editor sees it, so no
ProseMirror schema can recover it without carrying the source text alongside.

| Case | Lost where | Options | Recommendation |
| ---- | ---------- | ------- | -------------- |
| Emphasis/strong marker `*` vs `_` | mdast; not recorded | attr from `node.position` + custom `handlers` (Milkdown does this) / canonical | **Canonical.** `emphasis: '*'`, `strong: '*'`. The hint costs a custom serialiser handler per mark and only matters to the author's muscle memory |
| Bullet marker `-` `*` `+`, ordered delimiter `.` vs `)` | mdast; not recorded | same | **Canonical.** `bullet: '-'`, `bulletOrdered: '.'` |
| ATX vs setext headings | mdast; not recorded | global `setext` option / per-node attr | **Canonical.** `setext: false` |
| Indented vs fenced code, fence char, fence length | mdast; indented code and fenced code are the same node | attr / canonical | **Canonical.** `fences: true`, `` fence: '`' `` |
| Nested-list indentation | mdast; not recorded | global `listItemIndent` / canonical | **Canonical.** `listItemIndent: 'one'` |
| Hard break `\` vs two trailing spaces | mdast; both are `break` | attr / canonical | **Canonical**, and prefer `\`: trailing whitespace is invisible, stripped by editors, and by many CI lint rules |
| Character references (`&copy;` → `©`) | mdast; decoded at parse | canonical | **Canonical.** Renders identically |
| Escape placement (`1\.` → `1.`, `inside_a_word` → `inside\_a\_word`) | mdast; escapes are not nodes | canonical | **Canonical.** Renders identically; the serialiser's escaping is the safe one |
| GFM autolink literal → `<autolink>` | mdast; `link` either way | attr (`raw: true`) / canonical | **Canonical** |
| Table cell padding | mdast; whitespace only | `tablePipeAlign` option | **Canonical, but set `tablePipeAlign: false`** — finding 5 |
| Short table row padded to header width | mdast-util-gfm-table | none | **Accept.** Renders identically |
| Soft line wraps inside a paragraph | survives mdast *and* the converter, but not a live editor | preserve in the PM text node / collapse to a space | **Collapse, once, on first publish.** See below |
| Reference-style link definitions | **not lost** | attrs on the `link` mark + a `definition` block node | **Attrs.** Implemented; `07-reference-links.md` is byte-identical |
| Inline HTML | **not lost** | `htmlInline` atom node | **Atom node.** Implemented; `08-html-blocks.md` is byte-identical. The editor shows it as an uneditable chip with a raw-source popover |
| Block HTML | **not lost** | `htmlBlock` code-like node | **Node.** Implemented; edited as raw text, like a code block |
| Mark nesting order (`**_a_**` vs `_**a**_`) | ProseMirror; marks are a set, not a tree | none | **Accept.** Serialise in a fixed order (link, bold, italic, strike, code-innermost). Renders identically |
| Front matter fields the schema does not know | **not lost** | raw string on a `frontMatter` node | **Raw string.** Never re-emit parsed YAML |

**Soft line wraps deserve the detail.** A source-wrapped paragraph survives mdast
(the newline is inside the `text` node) and survives this converter (ProseMirror
text nodes may contain `\n`). It does not survive a *live* editor: the newline is
invisible in the DOM, no keystroke produces one, and the first edit to the
paragraph destroys it. Running the harness with `--collapse-soft-breaks`, which
models the live editor, drops the corpus from 9 to 5 byte-identical and from 18
to 8 semantically identical — and stays 19/19 idempotent, because the only change
is `"\n"` becoming `" "` inside text nodes, which renders identically.

This is precisely ADR-002's "the first publish from the editor may normalise
formatting once". The recommendation is to collapse rather than to fake
preservation: an editor that pretends to keep wrap positions will keep them
inconsistently, which is worse than normalising them predictably. An optional
serialise-time re-wrap at a fixed column is a later, separate feature and must be
all-or-nothing per document.

## Options

| Option | Strengths | Weaknesses | Rewrite risk if wrong |
| ------ | --------- | ---------- | --------------------- |
| **A. ProseMirror via TipTap, converter in `packages/markdown`** (ADR-003 as written) | Measured here: 19/19 converter-lossless, 19/19 idempotent, 18/19 semantic. Every extension needed is MIT. Headless schema construction means one schema for server and browser. Largest ecosystem and documentation; standard Yjs path for later co-editing | Three defects must be worked around (code-mark exclusion, `::` escaping, unknown-node hatch). TipTap owns the node names, so a major upgrade can move them (v2 → v3 moved TaskList and folded in Link). Marks are a set, so mark nesting order is not recoverable | Low. The converter is pure TypeScript over mdast and a PM schema; replacing TipTap with bare ProseMirror keeps `mdast-to-pm.ts` and `pm-to-mdast.ts` almost untouched |
| **B. Milkdown** | Converter co-located with node specs; already solves the same problem | Throws on unknown nodes; flattens reference links; inline-only HTML node; drops code-block `meta`. Smaller community. Its plugin/ctx system would own Quill's editor architecture | Medium. Its opinions are baked into the node specs we would inherit |
| **C. Bare ProseMirror, no TipTap** | No third-party opinions about node names or mark exclusions; nothing to work around | Quill writes and maintains input rules, keymaps, list commands, table commands, drag handles, bubble menus — months of work TipTap gives away, all of it accessibility-sensitive | Low, but the cost is paid up front instead of avoided |
| **D. CodeMirror-first, rich preview, no WYSIWYG** | Byte-preserving fidelity for every document, trivially | Fails the product's first users; ADR-002 already chose named fidelity levels precisely so a rich editor is possible | High. Reverses ADR-002's framing and section 17 of the plan |

## Recommendation

**Accept ADR-003 as written, with three additions recorded in its Decision
section.** The exit criterion it set — "a converter that round-trips the corpus
with the fidelity levels of ADR-002" — is met: canonical output is idempotent for
every document tested, semantic preservation holds for every document except one
whose difference is rendering-identical whitespace padding applied by remark, and
the ProseMirror hop itself introduced no loss anywhere.

The three additions:

1. `packages/markdown` re-declares TipTap's `Code` mark with `excludes: ''`.
2. `packages/markdown` ships the `::` escaping plugin and a serialise-time
   round-trip assertion in tests.
3. The schema carries a `rawMdast` escape-hatch node, and the converter never
   throws on an unknown mdast node.

And two settings choices worth registering:

4. `remark-gfm` is configured with `tablePipeAlign: false`, to halve the diff
   noise of every table edit in Git sync.
5. Soft line wraps inside paragraphs are collapsed to spaces on the first publish
   from the editor, and the diff view labels the change as formatting-only.

**What would change this recommendation.** If TipTap moved `@tiptap/extension-table`
or `@tiptap/extension-list` behind the Pro licence, option C (bare ProseMirror
plus `prosemirror-tables` 1.8.5, MIT, in the ProseMirror organisation, which
`@tiptap/pm` already depends on) becomes the fallback, and the converter is
unaffected. If the
editor's accessibility testing in the first editor milestone finds TipTap's
table and list interactions unusable with a screen reader, that is a reason to
replace TipTap, not the converter.

## Converter design for `packages/markdown`

### Shape

Two-stage in both directions, with mdast always in the middle, exactly as ADR-004
requires: `markdown ⇄ mdast ⇄ ProseMirror`. The Markdown string is never produced
from the ProseMirror document directly, and the editor never sees Markdown text.

Organise it Milkdown's way rather than this spike's way: each ProseMirror node
and mark definition carries its own `fromMdast` and `toMdast` pair, so adding a
directive means adding one file, not editing two switch statements. That also
gives ADR-004's "defined once" property a place to live: the same file holds the
node spec, the two converter halves, the renderer, and the degradation rule.

### Node mapping

| mdast | ProseMirror | Attributes |
| ----- | ----------- | ---------- |
| `root` | `doc` | |
| `yaml` | `frontMatter` (block atom, isolating) | `value` — the **raw** YAML string, never re-emitted from a parsed object |
| `paragraph` | `paragraph` | `layout`, `directiveLabel`, `synthetic` |
| `heading` | `heading` | `level` (= `depth`), `layout` |
| `text` | `text` | |
| `emphasis` | mark `italic` | |
| `strong` | mark `bold` | |
| `delete` | mark `strike` | |
| `inlineCode` | mark `code` on a text node | requires `excludes: ''` |
| `link` | mark `link` | `href` (= `url`), `title` |
| `linkReference` | mark `link` | `referenceType`, `identifier`, `label`, `href: null` |
| `definition` | `definition` (block atom, isolating, invisible in the editor) | `identifier`, `label`, `url`, `title` |
| `image` | `image` (inline atom) | `src` (= `url`), `alt`, `title` |
| `imageReference` | `image` | `referenceType`, `identifier`, `label`, `src: null` |
| `break` | `hardBreak` | inherits the surrounding marks |
| `list` (ordered) | `orderedList` | `start`, `spread`, `layout` |
| `list` (all items checked) | `taskList` | `spread`, `layout` |
| `list` (other) | `bulletList` | `spread`, `layout` |
| `listItem` | `listItem` / `taskItem` | `spread`; `checked` (`null \| true \| false`) on `listItem` for mixed lists, `checked` boolean on `taskItem` |
| `blockquote` | `blockquote` | `layout` |
| `code` | `codeBlock` | `language` (= `lang`), `meta`, `layout` |
| `thematicBreak` | `horizontalRule` | `layout` |
| `table` | `table` → `tableRow` → `tableHeader`/`tableCell` | `align` (array) on the table; cells wrap phrasing in a `synthetic` paragraph |
| `html` (block position) | `htmlBlock` (`content: 'text*'`, `code: true`, `marks: ''`) | `layout` |
| `html` (inline position) | `htmlInline` (inline atom) | `value` |
| `footnoteDefinition` | `footnoteDefinition` | `identifier`, `label` |
| `footnoteReference` | `footnoteReference` (inline atom) | `identifier`, `label` |
| `containerDirective` | `containerDirective` (`content: 'block+'`) | `name`, `attributes` (JSON), `layout` |
| `leafDirective` | `leafDirective` (`content: 'inline*'`) | `name`, `attributes`, `layout` |
| `textDirective` | `textDirective` (inline, `content: 'inline*'`) | `name`, `attributes` |
| anything else | `rawMdast` (block atom) | `node` — the subtree as JSON |

Mark serialisation order, outermost first: `link`, `bold`, `italic`, `strike`,
`code`. `code` is last because `inlineCode` is an mdast leaf.

### Attributes that exist only to carry formatting hints

Keep these; they are cheap and they buy real fidelity:

- `link.referenceType` / `identifier` / `label`, plus the `definition` node —
  reference-style links survive byte-identically, which matters because README
  badge blocks and changelogs are full of them.
- `image.referenceType` / `identifier` / `label` — the same for images.
- `codeBlock.meta` — `` ```ts title="server.ts" `` survives.
- `list.spread`, `listItem.spread` — loose vs tight lists.
- `listItem.checked` — GFM's mixed checkbox lists.
- `table.align` — GFM column alignment.
- `paragraph.directiveLabel` — `:::note[Label]`.
- `paragraph.synthetic` — marks a paragraph the converter invented to satisfy a
  ProseMirror content expression, so it can be removed again.

Do **not** add attributes for emphasis markers, bullet markers, heading style,
fence style, indentation, or hard-break style. ADR-002 already licenses
normalising them once, each would need a custom `remark-stringify` handler, and
they change nothing a reader can see.

### Directives and layout widths

`:::name{k=v}` is a `containerDirective` node carrying `name` and an
`attributes` object. Unknown names are kept as-is; the renderer's degradation
rule for an unknown directive is to render its children and drop the wrapper.

ADR-027's `:::wide` and `:::full` are the **same node type**, lifted at the
editor boundary so the author never sees a wrapper block:

- **On load**, after mdast → ProseMirror: any `containerDirective` whose `name`
  is `wide` or `full`, with no attributes, whose children can all carry a
  `layout` attribute and none of which already has one, is replaced by its
  children, each with `layout` set to the name.
- **On save**, before ProseMirror → mdast: runs of adjacent sibling blocks with
  the same non-null `layout` are re-wrapped in one `containerDirective`, and the
  `layout` attributes are cleared.
- Front matter `layout: wide | full` remains the document default and is read
  from the `frontMatter` node's YAML by the front-matter schema (ADR-005), not by
  the converter.
- The editor's block menu writes the `layout` attribute; no user-facing command
  ever creates or deletes a `:::wide` node directly.

Measured lossless on the corpus in both directions. Two accepted normalisations:
adjacent same-width wrappers merge, and a wrapper whose children cannot carry
`layout` stays a visible container block.

### Serialisation profile

```ts
{ bullet: '-', bulletOrdered: '.', emphasis: '*', strong: '*',
  fence: '`', fences: true, rule: '-', ruleRepetition: 3,
  listItemIndent: 'one', incrementListMarker: true,
  tightDefinitions: true, setext: false, resourceLink: false }
```

with `remark-gfm` configured `{ tablePipeAlign: false }` and the `::` escaping
plugin registered. This profile is part of the public contract of
`packages/markdown`: changing it re-flows every document in the corpus, so it
needs its own ADR amendment if it ever moves.

### Tests the package must carry

1. The 19-document corpus from this spike, moved into `packages/markdown`, with
   the four assertions per document (`byte`, `conv`, `sem`, `idem`). `conv` and
   `idem` must be 100%; `sem` failures must be listed explicitly with a reason.
2. `serialise(parse(x))` is idempotent — the property-based test ADR-002 asks
   for, generating directives, nested lists, tables and front matter.
3. Every converted document passes `Node.check()` against the schema.
4. Unknown front matter, unknown directives, and an invented mdast node type come
   back deep-equal.
5. A guard test asserting `schema.marks.code.excluded.length === 0`, so a TipTap
   upgrade that re-introduces the exclusion fails loudly.

## Consequences

- `packages/markdown` depends on `@tiptap/core` for `getSchema()`. That is
  acceptable and does not break ADR-004's framework-free rule: `getSchema()`
  touches no DOM and no React, proven in `tiptap-probe.ts`. The alternative — a
  hand-written `prosemirror-model` schema duplicated from the extension list — is
  the thing that actually drifts.
- The first publish of a document written outside Quill will produce a
  formatting-only diff for most documents: 38 of 897 corpus lines with the
  recommended settings. The diff view must label these, as ADR-002 already says.
- Documents never opened in the editor must not be re-serialised at all, or
  byte-preserving fidelity is lost for them. The content store writes back only
  what the editor produced.
- The editor must treat `definition`, `frontMatter`, `htmlBlock`, `htmlInline`
  and `rawMdast` as first-class but non-WYSIWYG: visible, selectable, deletable,
  edited as raw text, never silently dropped.
- Multi-block table cells, and a `:::wide` that wraps a `definition`, are the two
  places where the editor can build a document the Markdown cannot fully express.
  Both must be prevented in the editor rather than repaired in the serialiser.

## Resulting ADR

[ADR-003: Editor architecture](../architecture/decisions/0003-editor-architecture.md)
— accept as written, adding the five items in the Recommendation. ADR-027's
editor affordance is confirmed: `layout` is a block attribute in ProseMirror and
a container directive in Markdown, and the two representations convert both ways
without loss.
