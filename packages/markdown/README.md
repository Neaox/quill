# @quill/markdown

Markdown is the document. This package parses it, checks it, renders it, converts it for the editor, and writes it back — and nothing else in the codebase is allowed to do any of those (ADR-002, ADR-003, ADR-004, ADR-005). It is framework-free and touches no DOM, so the same code runs on the server, in a worker, and in the browser.

## What is canonical

CommonMark plus GitHub Flavored Markdown, with YAML front matter, plus directive syntax (`:::name`) for everything else. Serialisation is deterministic: re-serialising an unchanged document produces the bytes it came from, and serialising the result again changes nothing. The serialisation profile in `pipeline/options.ts` is part of the public contract; changing it re-flows every document in every repository we sync with, so it needs an ADR amendment. Unknown front matter fields and unknown directives survive the round trip untouched, and nothing here throws on input it does not recognise — an unmodelled construct is carried on the `rawMdast` escape hatch instead.

## Fidelity levels

- **Byte-preserving** — a document never opened in the editor is never re-serialised.
- **Semantic-preserving** — a document opened in the editor may be normalised once, on first publish. What an author sees is **soft line wraps collapsing to spaces** (ADR-003), together with **CRLF and CR line endings becoming `\n`**, **a leading byte-order mark dropped**, and **the blank lines that end a file becoming its one final newline**. Everything else is written as it was read (`pipeline/source-form.ts`): emphasis markers, hard breaks, a table's delimiter row and unchanged rows, directive attributes, blank lines between blocks and inside container fences, ordered list numbers, GitHub alert markers, and escapes, which are written only where they change how the text reads. Three things mdast does not keep are still normalised: character references (`&copy;` is written `©`), a backslash the author wrote where none was needed (`2026\.`), and the padding inside a code span; and an escape the writer cannot prove unnecessary from one text node alone (`(ST-*)`, `r4\` at the end of a paragraph) is kept. The diff view labels the change as formatting-only.
- **Canonical** — everything this package writes. Measured over the 26-document corpus: 24 byte-identical, 26 converter-lossless, 26 semantically identical, 26 idempotent (`prosemirror/corpus.test.ts`, which names the two that are not, and why). On first save from the editor, the same 24 come back as they were but for their soft wraps, as do 185 of the 189 documents in lockstay's `docs/` (`prosemirror/real-docs.test.ts`, with `QUILL_REAL_DOCS`).

Line endings are settled at `parseDocument`, before anything downstream sees the
tree, because a `\r` is not only cosmetic: an HTML parser drops it while building
a text node, so a code block's packed token offsets (ADR-030) would land a
character further along on every line after the first, and a tree holding `\r\n`
in one node and `\n` in the next writes a file with mixed line endings.

## Directives

| Directive | Shape | Purpose |
| --- | --- | --- |
| `:::callout{type}` | container | An aside the reader should notice: note, info, tip, warning, caution |
| `:::wide`, `:::full` | container | Block layout widths (ADR-027); a block attribute in the editor |
| `:placeholder[…]`, `:::placeholder` | text, container | A prompt the author replaces; removed at publish |
| `:::guidance` | container | Advice to the author; removed at publish |
| `:::optional{title}` | container | An offered section; published only once added |
| `:::when{question}` | container | Conditional content; resolved at creation, never published |
| `:::repeat{title}` | container | A section the author may add again; instances are published |
| `:::notes` | container | Presenter notes; shown in presentation mode only |
| `:kbd[…]` | text | Keys the reader presses, rendered as `kbd` |
| `:badge[…]{tone}`, `:ok` `:warn` `:bad` `:accent` `:plan` | text | A status pill; the words are the meaning, the tone emphasis (ADR-036) |
| `:<label>[…]`, such as `:acme[Acme]` | text | One of the organisation's labels (`RenderOptions.labels`), drawn as a badge with `data-label` and coloured by the theme; a name the theme does not define reads as written (ADR-037) |
| `:small[…]` | text | Small print, rendered as `small` |
| `:::figure` | container | A block and the paragraphs that caption it, as `figure` and `figcaption` |
| `:::cards{variant}` | container | Each heading starts a card; `panels` or `ruled` |
| `:::table[caption]{width columns headers footer freeze responsive sort caption}` | container | Reading options for the one GFM table inside: its caption, widths, row headers, footer and what is frozen (ADR-040) |

Two more constructs render specially without any directive. GitHub's alerts (`> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`) render as callouts and stay blockquotes in the source. A ` ```mermaid ` fence renders as a diagram slot holding its source, which the reader draws; and an SVG attachment shown on its own line is drawn inline through `src/render/drawing.ts`'s allowlist (ADR-036).

Every one degrades, and what "degrades" means depends on the shape:

- **A container directive** (`:::name`) renders its children and drops the wrapper, exactly as a renderer that never heard of it would.
- **A text directive** (`:name`) renders as the source the author typed — `:name`, its `[label]`, its attributes — because that is what a renderer with no directive support shows, and because `:` is a directive marker to the parser: `Ratio 3:2` holds a text directive named `2`, and rendering only its (empty) children silently deleted the author's prose.
- **A leaf directive** (`::name{…}`) is the live-block syntax of ADR-032. Until a block type is registered it renders as a slot — a `section` naming the type, with the same readable source form inside — rather than as nothing at all.

## Security

`renderHtml` (`src/render/html.ts`) sanitises every document itself, on every call, before its result can reach a caller — including the render cache (ADR-031) — because ADR-011 makes that this renderer's job, not a downstream caller's. Three things happen in order:

1. **Raw HTML is escaped, not parsed.** `rehype-raw` is not a dependency, so an author's `<div>`, a stray `<script>`, or an `<img onerror>` never becomes a real element for a sanitiser to inspect; `src/render/escape-raw-html.ts` turns every one into a plain text node first, so it renders as inert, visible, HTML-escaped text (`&lt;script&gt;…`) instead of executing or silently disappearing.
2. **Every element and attribute is checked against an allowlist.** `src/render/sanitize-schema.ts` extends `hast-util-sanitize`'s default schema (the same one GitHub sanitises rendered Markdown with) with only the elements and attributes this package's own handlers emit — callouts, layout wrappers, tables, code blocks, template sections, and so on — each traced to its call site in a comment. `href`/`src` are restricted to `http`, `https`, `mailto`, relative paths, and id-based document fragments; `data:` is allowed only on `img`, only for `image/*`. Nothing here widens the default for content this package does not itself produce.
3. **External links get `rel="noopener noreferrer"`**, added once over the finished tree (`src/render/external-link-rel.ts`) rather than duplicated into every place an `<a>` can originate.

Two details of that allowlist are worth stating plainly. A heading's `id` is prefixed `user-content-`, because a slug comes from the author's own heading text and an unprefixed one could collide with the application's ids or clobber a same-named global; the anchor's `href` and `extractOutline`'s ids carry the prefix so a table of contents still resolves (`src/render/slug.ts`). And `href` refuses a protocol-relative `//host/path`, which hast-util-sanitize reads as relative and which is neither our own content nor an explicit `https:` link.

`src/render/render.security.test.ts` proves the result against an adversarial corpus — script tags, event-handler attributes, `javascript:`/`data:text/html` URLs (including obfuscated and entity-encoded variants), `<iframe>`/`<object>`/`<base>`/`<meta>`/`<form>`, and directive attribute values crafted to break out of an HTML attribute — and asserts none of it ever produces a live script, event handler, or dangerous URL, while legitimate content still renders unchanged.
