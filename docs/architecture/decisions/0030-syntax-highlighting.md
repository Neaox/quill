# ADR-030: Syntax highlighting

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md sections 16, 17, 23, 31; ADR-003, ADR-023, ADR-028; reference implementation studied: Overcast (`overcast-sh/overcast`, `web/src/lib/highlight-*.ts`, `prism-ranges.ts`, `styles/syntax-tokens.css`)

## Context

Code is first-class content for the first users. Highlighting must be clean, DRY, performant, and consistent across the reading surface, presentation mode, the public site, exports, and the editor, and it must use the CSS Custom Highlight API where the browser supports it (Chrome 105+, Safari 17.2+, Firefox 140+) with a Prism-based fallback elsewhere.

Overcast's implementation is the reference. Its ideas worth keeping: one facade with two presentations (ranges painted through `CSS.highlights` over a single text node, or Prism markup spans), one page-global `Highlight` object per token class with per-block disposers, token colours expressed once as `--token-*` variables consumed by both `.token` class rules and separate `::highlight()` rules, a grammar-coverage test that fails the build when a grammar can emit a class the theme does not colour, a persistent worker for large inputs with a packed transferable reply, an LRU cache keyed by language and text that returns the identical value on a hit, and a single component that chooses text and language but never a backend. Where Quill differs is that its reading surfaces are server-rendered documents, not virtualised log rows.

## Decision

### One tokenizer, one range model

- `packages/highlight` (its own package, so the renderer and the server depend on it without the Markdown pipeline owning grammars) provides `tokenize(text, language): TokenRange[]`, where a range is `[start, end)` in UTF-16 units plus a resolved token class. Prism grammars are the tokenizer; they run on the server and, where needed, in a worker. Nothing in this module touches the DOM.
- Ranges tile the text, nested tokens contribute their leaves labelled with the innermost class, and a multi-class token resolves to one themed class by a fixed precedence list. A leaf whose own classes are themed nowhere takes the class of the nearest enclosing token that is, because grammars name the parts of a construct as freely as the construct itself — a diff's `line` inside its `deleted-sign`, an f-string's `format-spec` inside its `interpolation` — and without that rule a deleted line would colour its leading `-` and leave the text it deletes plain. That list is the single source of truth for the CSS, the coverage test, and both presentations.
- Offsets are UTF-16 units into the code block's text **as the DOM holds it**. `packages/markdown` normalises a document's line endings to `\n` at parse for exactly this reason: an HTML parser collapses `\r\n`, so ranges counted over the `\r` would be a character out on every line after the first.
- Two pure derivations exist from ranges and nowhere else: `toMarkup(text, ranges)` produces `<span class="tok-…">` markup, and `packRanges` / `unpackRanges` produce a compact string form for transport. The packed form carries a version and its reader dispatches on it (ADR-033): a payload written by a format this build has never shipped is refused, not read as if it were version 1. Both derivations treat their input as untrusted — `toMarkup` clamps ranges into the tiling it promises, `unpackRanges` refuses a negative or malformed field — because a `data-tokens` attribute is read by a client that did not write it.

### The server tokenizes; readers do not download grammars

- The Markdown renderer emits every fenced block as one text node with `data-lang` and `data-tokens` (the packed ranges), cached by content hash alongside the rendered HTML. The renderer does not import the tokenizer; it takes a `highlighter(text, language)` function as an option, and the server composes the two. That keeps `packages/markdown` free of grammars and lets tests render without them. A block above a size threshold omits `data-tokens` and is highlighted on demand.
- On the client, one `applyHighlighting(root)` runs after hydration and reads `data-tokens`. Where `CSS.highlights` exists it builds `Range` objects into the per-class global highlights; elsewhere it swaps the text node for `toMarkup` spans once. A block whose attribute cannot be read costs that block its colour and nothing else — a page is a whole document's worth of blocks, and one stale or truncated attribute must not leave the rest of them plain. No Prism grammar ships in the reading bundle, which keeps the first-load budget of section 31 intact.
- Crawlers and readers without JavaScript get correct, uncoloured monospace text. On fallback browsers the only visible cost is that colour arrives at hydration rather than at first paint, accepted because that set shrinks every year.
- Static outputs that never run script (HTML export, PDF, email) render `toMarkup` spans on the server from the same ranges.

### Colours are theme tokens

- `syntax-tokens.css` declares `--token-<class>` per theme scope, generated with the rest of the palette (ADR-028) so token hues stay fixed and lightness follows light or dark and the tenant's tone. Classes that share a colour alias one variable, so each colour is stated once.
- Two selector families read those variables: `.tok-<class>` for markup, and `::highlight(quill-tok-<class>)` for ranges. They are separate rules, never comma-joined, because a browser without the pseudo-element drops the whole selector list.
- `::highlight()` can only paint colour, background, text-decoration, and text-shadow, so token styles are colour-only in both presentations. No italic comments, no bold keywords; parity beats flourish.
- A coverage test enumerates every class the registered grammars can emit and fails when one lacks a variable in every theme scope or a rule in either selector family. Coverage is measured on the class **groups** a token actually wears — a rule's name together with its aliases, because the diff grammar never emits `deleted-sign` without `deleted` beside it — and every group that resolves to no colour is listed in a reviewed allowlist with the reason it carries none: a container that hands its span to another grammar, a part that inherits its construct's colour, or a class Prism's own theme leaves at the reader's text colour. The list is an allowlist, not a filter: a grammar that starts emitting something new fails the build until it is either themed or reviewed into it.
- `data-lang` names the language the tokenizer resolved, not the fence tag as written, so the attribute and the ranges beside it always describe the same grammar. Where no tokenizer ran, the fence tag is used only if it reads as a bounded language name.

### The editor

- Code blocks in the editor are CodeMirror 6 (ADR-003), highlighted live by Lezer. Its highlight style maps Lezer tags onto the same `--token-*` variables, so a block looks the same while being written as when read. Lezer and Prism draw token boundaries slightly differently; the variables, not the tokenizer, are the consistency contract.
- Presentation mode uses the reading renderer and inherits ranges unchanged.

### Performance rules

- Server tokenization results are part of the render cache keyed by content hash; a republish invalidates exactly the blocks that changed.
- Client range application happens in one pass per page, after hydration, without DOM mutation; a `Highlight` is a set of pointers.
- A persistent worker, never a worker per call, is used only where tokenization happens on the client (the editor's large blocks, on-demand blocks above the threshold), with the reply as a packed transferable buffer. Small inputs tokenize synchronously.
- An LRU cache keyed by language and text returns the identical object on a hit, so React and the range effect skip work.

## Alternatives considered

- **Prism markup everywhere, server-rendered.** Simplest, works without JavaScript, but a large runbook script becomes thousands of spans in the accessibility tree and DOM, and theming stays possible only through class rules. Kept as the static-export path.
- **Client-side tokenization with shipped grammars.** Rejected: every reader downloads grammars they may never need, and the same block is tokenized on every device instead of once on publish.
- **Shiki or TextMate grammars.** Richer scopes, but heavy grammars and a WASM regex engine; not justified while colour-only parity is the contract. Revisit if scope-level fidelity becomes a product requirement.
- **Highlight API only, no fallback.** Rejected: Firefox before 140 and older Safari are still in use.

## Consequences

- `packages/markdown/highlight` is pure TypeScript with full coverage, tested against a corpus of code blocks per grammar.
- Adding a language means registering its grammar and satisfying the coverage test; nothing else changes.
- Themes cannot style tokens beyond colour, which is a deliberate limit recorded in ADR-028.
- The `data-tokens` payload is bounded by the size threshold and compresses well; its cost is measured in R2's fidelity corpus as part of the render budget.
