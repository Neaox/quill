# Reading surfaces and editor: an accessibility and semantics audit

<!-- cspell:words axe tablist tabpanel rowheader columnheader focusable aria WHCM roledescription keyshortcuts labelledby describedby lockstay oklch -->

**Question.** Does the HTML Quill renders for document content (the renderer, the reader enhancers, the public-site chrome around them, and the editor's node views) meet WCAG 2.2 AA and the WAI-ARIA Authoring Practices? What exactly fails, and where is each fix made?

**Date.** 2026-10-11. Read-and-test only. No product code was changed.

## Method

1. **Read** `packages/markdown/src/render` (`handlers.ts`, `table-block.ts`, `sanitize-schema.ts`, `drawing*.ts`, `html.ts`, the link passes), `packages/markdown/src/code-group/render.ts`, `packages/markdown/src/emoji/emoji.ts`, every enhancer in `packages/design-css/src` (code blocks and copy, tables, sort, table viewer, viewer, lightbox, reader, sticky chrome), `prose.css` and `public-site.css`, `apps/server/src/public-site/templates`, `apps/web/src/lib/diagrams/draw-diagrams.ts`, and the editor's code-block and code-group node views.
2. **Rendered the corpus.** I rendered all 26 files in `packages/markdown/corpus` through `renderHtml` and served each one inside the public site's real page shell, with its stylesheet and reader script. I also rendered a probe document of my own covering: links in table headers, a footnote reference in a header, a labelled callout, a GitHub alert, a Mermaid fence, cards, `kbd`, a badge, and Unicode and custom emoji.
3. **Tested in a browser.** I used Playwright Chromium 1.63, driven from a scratch script, against the running dev servers (public site on :3000, app on :5173, signed in as the seed admin). I ran axe-core 4.13.0 (the repo's own copy, `node_modules/.pnpm/axe-core@4.13.0`) with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice`, in light and dark. Beyond axe:
   - walked the full Tab order of three pages and recorded each stop's name, role, focus ring and opacity;
   - checked tablist keys (arrows, Home, End), sorting, the table viewer and the diagram lightbox (focus in, Tab cycle, Escape, focus return, duplicate ids while open);
   - took accessibility-tree snapshots (`ariaSnapshot`);
   - computed contrast myself (axe reported most text as "incomplete" because of a page-level pseudo-element);
   - emulated `forced-colors: active` in light and dark, and `prefers-reduced-motion`;
   - checked reflow at 320 and 640 CSS px (400 % and 200 % of 1280);
   - for WCAG 2.4.11, tabbed forward and backward at 320 × 256 and 1280 × 900 and measured whether the focused element was under the sticky chrome.
4. **Judged** each block against the APG pattern it implements and WCAG 2.2 AA.

**Context.** Other sessions were editing the renderer, code blocks, tables and emoji during the audit. The server restarted several times, and `code-blocks.ts` changed its id prefix (`quill-code-` became `code-group-`) partway through. Findings are against what was served on 2026-10-11 and are tied to code paths, so they survive small edits. I opened the editor on *Reading surface tour* once to inspect its node views. I typed nothing and closed it.

Severity is **A** or **AA** for a WCAG 2.2 failure at that level, and **BP** for best practice (APG conformance, robustness, or forced-colours support that WCAG does not strictly require).

## The most serious findings

1. **Task-list checkboxes have no accessible name.** This is axe `label` (critical) on every task list, on both surfaces. Separately, under forced colours a checked box draws as unchecked. In the editor, task items render with no checkbox at all, so the state is lost entirely.
2. **Sort buttons swallow interactive header content.** A link or footnote reference in a header cell ends up inside the `button` (`nested-interactive`), and the hanging header clone keeps those links focusable inside `aria-hidden`. An empty header cell gets a sort button with no name (`button-name`, critical).
3. **Focus is obscured (2.4.11).** Nothing sets `scroll-padding`, so sort buttons and expand buttons land fully under the sticky site header when tabbed to. This happened 58 times in one pass at 320 × 256, and also at 1280 × 900 when tabbing backwards.
4. **A callout's type is shown by colour only.** A directive callout without a label differs from the others only by the colour of its left border. A labelled callout's accessible name drops the type ("Custom label", not "Tip").
5. **Scrollable code and diagrams can't be reached by keyboard** (`scrollable-region-focusable`, serious). This affects any `pre` that overflows and any diagram slot wider than the column. Chrome now auto-focuses such scrollers; Firefox and Safari do not.
6. **The diagram lightbox can only be panned by dragging.** There is no keyboard pan (2.1.1) and no single-pointer alternative (2.5.7). Two viewer controls fail Label in Name: the visible "100 %" is named "Zoom: fit, or twice the size", and "MD" is named "Copy as Markdown".
7. **Status messages in the table viewer are never heard.** "Copy as CSV/Markdown" confirmations and sort announcements go to live regions outside the modal `<dialog>`, which is inert while the dialog is open (4.1.3).
8. **Heading names carry noise.** Every heading's accessible name includes its permalink ("Callouts Permalink: Callouts"). In the app, the `hairline` rule's generated `#` is part of the name as well ("#Callouts…"). The comment in `prose.css` saying generated content never reaches a screen reader is wrong.

## axe results per page

### Public site (`/s/architecture/…`), light and dark (identical)

| Page                          | Violations                                                                                                      | Duplicate ids | Notes                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------ |
| `/s/architecture` (index)     | none                                                                                                            | none          |                                                  |
| `authentication-architecture` | none                                                                                                            | none          | 35 contrast "incomplete" (pseudo-element)        |
| `code-groups`                 | `scrollable-region-focusable` ×2 (A, 2.1.1): `#quill-code-3-panel-0 > figure > pre`, `#quill-code-5-panel-0 …` | none          |                                                  |
| `reading-surface-tour`        | `label` ×3 (A, 4.1.2): task-list checkboxes; `scrollable-region-focusable` ×1: the JSON `pre`                   | none          | 368 contrast "incomplete"; manual check below    |
| `system-overview`             | none                                                                                                            | none          |                                                  |
| `table-showcase`              | none                                                                                                            | none          | 659 contrast "incomplete"                        |
| `the-sync-map`                | `scrollable-region-focusable` ×4: each `figure > .diagram[data-diagram=svg]`                                    | none          | Diagrams overflow sideways at 1280 in the column |

### Signed-in reader (`/w/engineering/d/…`, 1440 × 900)

| Document               | Violations                                                                                   | Duplicate ids |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------------- |
| `reading-surface-tour` | `label` ×3 (task-list checkboxes); `scrollable-region-focusable` ×1 (JSON `pre`)             | none          |
| `table-showcase`       | none                                                                                         | none          |
| `the-sync-map`         | none (the diagrams fit at 1440; at narrower widths they behave as on the public site)        | none          |
| `code-groups`          | `scrollable-region-focusable` ×2 (`#code-group-9-panel-0 > figure > pre`, `#code-group-11-…`) | none          |
| `system-overview`      | none                                                                                         | none          |

### Editor (`/w/engineering/d/reading-surface-tour…/edit`, scoped to the `contenteditable`)

| Violations                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target-size` ×5 (AA, 2.5.8): the code-block language inputs are 128 × 22.7 px. `scrollable-region-focusable` ×1: the JSON block's `.cm-scroller`, a near-false positive, because `.cm-content` is focusable but axe does not count `contenteditable`. |

### Corpus (26 files, public shell) and probe document

| File                       | Violations                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `04-task-lists`            | `label` ×15 (A)                                                                                                                              |
| `10-layout-directives`     | `heading-order` (BP): the author's own heading levels                                                                                        |
| `12-unknown-directive`     | `heading-order` (BP): the author's own heading levels                                                                                        |
| `13-readme-style`          | `button-name` (A, critical): the sort button in an empty `th`; `empty-table-header` (BP)                                                      |
| Probe (`zz-extra`)         | `nested-interactive` ×2 (A, 4.1.2): a link and a footnote reference inside a `button.table-sort`; `target-size` on the same buttons as a consequence |
| All other 21 corpus files  | none                                                                                                                                         |

No duplicate ids were found on any page, before or after enhancement, or while the table viewer or lightbox was open. Both move their content rather than copying it, and the header clone strips ids.

## Findings by block

Each finding has an id (F-n) used by the fix list at the end.

### Headings and permalink anchors

**Structure.** `<hN id="user-content-slug">Text<a class="heading-anchor" href="#user-content-slug" aria-label="Permalink: Text">#</a></hN>`. Under `data-rules="hairline"`, `h2::before { content: '#' }`.

**Passes.**
- One `h1` per page.
- The anchors are keyboard reachable, become visible on focus (`:focus-visible` sets `opacity: 1`), and have a 2 px focus ring.
- Ids are clobber-prefixed and fragment links are rewritten to match.
- `scroll-margin-top` clears the bar for anchor targets.

| Id  | Severity      | WCAG         | Finding and reproduction | Fix |
| --- | ------------- | ------------ | ------------------------ | --- |
| F8  | BP            | 1.3.1, 2.4.6 | **The heading's name repeats itself.** The anchor sits inside the heading, so the name is "Callouts Permalink: Callouts" (seen in `ariaSnapshot` of any article). In the app, `hairline` adds generated content too: `heading "#CalloutsPermalink: Callouts"`. Headings-list navigation reads every heading twice, prefixed with "hash". | `packages/design-css/src/prose.css` (the `[data-rules='hairline'] … h2::before` rule, around line 99): `content: '#' / '';`, and correct the comment above it, which claims generated content never reaches a screen reader. `packages/markdown/src/render/handlers.ts` `heading`: emit the anchor as a sibling after the heading, inside a wrapper (`<div class="heading-block"><h2 id>…</h2><a class="heading-anchor" …>`), as GitHub now does. Update `sanitize-schema.ts` (`div` class) and the heading styles to match. **Resolved 2026-10-17:** The heading is now named by its words alone. They sit in a span, and the heading points at it with `aria-labelledby` (`title.<slug>`, prefixed by the sanitiser), so the anchor stays on the heading's line. A sibling wrapper would have broken `.prose > h2` selectors and the presenter's split. The link is named "Link to this section: …" and its `#` is an `aria-hidden` span. The hairline rule uses `content: '#' / ''`, and the misleading comment is corrected. The accessibility tree now reads `heading "Callouts" [level=2]` (`render.test.ts`, `render.security.test.ts`). |
| F13 | AA            | 1.4.3        | **The anchor's `#` is 3.33:1 in light** (3.61:1 on a white card), using the colour `--color-border-strong` on the page background. It is text at 0.8 em of the heading. Hover a heading on any page in light mode. | `prose.css` `.prose .heading-anchor`: use `--color-muted` (5.07:1 light, 6.63:1 dark). **Resolved 2026-10-17:** The anchor now uses `--color-muted`: 5.07:1 in light and 6.63:1 in dark. It is held to 4.5:1 because the `#` is a text glyph at 0.8 em of the heading, not an icon. The reasoning is in the comment in `prose.css`. |
| —   | BP            | 2.5.3        | The visible text is "#" and the name is "Permalink: …". This is acceptable: it is a symbol, not a word label. | none needed |

### Lists and task lists

**Structure.** `ul.contains-task-list > li.task-list-item > input[type=checkbox][disabled][checked?]` followed by the item's text as a sibling.

**Passes.**
- The checkbox is `disabled` and exposes checked or unchecked (`checkbox [checked] [disabled]` in the tree).
- Nested and ordered lists are native.

| Id  | Severity | WCAG          | Finding and reproduction | Fix |
| --- | -------- | ------------- | ------------------------ | --- |
| F1  | A        | 4.1.2, 1.3.1  | **The checkbox has no accessible name** (axe `label`, critical, ×3 on the tour and ×15 in corpus 04). A screen reader says "checkbox, checked, disabled" and then reads the text as a separate node. | `packages/markdown/src/render/handlers.ts`: add a `listItem` handler. When `node.checked` is not null, give the `input` `aria-label` set to `toString` of the item's first paragraph, or wrap checkbox and text in `<label>`. Admit `ariaLabel` on `input` in `sanitize-schema.ts` (the default admits only `type`, `checked`, `disabled`). **Resolved 2026-10-17:** A `listItem` handler in `render/task-list.ts` names the item's own checkbox from its first paragraph ("Task" when it has no words). The sanitiser admits only the literal `aria-label` on `input`, and `defaultSchema.required.input` still forces a disabled checkbox. Covered by `render.test.ts` and `render.security.test.ts`. axe `label` is now 0, against 3 on the tour and 15 in corpus 04. |
| F15a | AA      | 1.4.11 (forced colours) | **Under `forced-colors: active` a checked box looks unchecked.** The box is `appearance: none`. Its fill is `background-color` and its tick is a masked background, and forced colours remove both. Screenshot: all three tour items look empty. | `prose.css`, task-list block: add `@media (forced-colors: active) { .prose .task-list-item > input:checked { background-color: Highlight; border-color: Highlight } .prose .task-list-item > input:checked::before { background-color: HighlightText; forced-color-adjust: none } }`. Alternatively, restore `appearance: auto` there. **Resolved 2026-10-17:** Under `forced-colors: active`, the box gets a `CanvasText` border, and a checked one is filled `Highlight` with a `HighlightText` tick (`forced-color-adjust: none`). Computed under emulation: fill rgb(55,0,110), tick white. |
| F19 | A        | 1.3.1         | **In the editor, task items have no checkbox.** `<ul class="task-list"><li class="task-item" data-checked="true">` renders as plain bullets, and the tree shows plain `listitem`s. Checked state is neither visible nor announced, and there is no way to toggle it. Open the tour in the editor and look at "Before this ships". | `packages/editor/src/schema` (the `taskItem` entry in `dom.ts` and its extension): add a node view rendering a real `<input type="checkbox">` (`contenteditable=false`), labelled by the item's text, toggling `checked` through a command. **Resolved 2026-10-17:** Added `packages/editor/src/task/task-item-view.ts`, which draws a native checkbox named by the task's words. Click, Space and Mod-Enter toggle `checked` as one undoable step. `[x]`/`[ ]` round-trip byte for byte, and axe is clean (`task-item-view.test.tsx`). It works with every way a task list is made: the `[] ` autoformat, the slash item and paste, because it is a node view over `taskItem`. |

### Block quotes, callouts and GitHub alerts

**Structure.**
- A plain quote is `<blockquote>`.
- A callout is `<aside class="callout callout-{type}" role="note" aria-label="{Type or label}">`.
- An alert adds a visible `<p class="callout-label">Warning</p>`.
- The editor uses `<div class="directive directive-callout" role="group" aria-label="Callout: note">`.

**Passes.**
- `role="note"` stops every callout from becoming a complementary landmark.
- GitHub alerts show their kind in words.
- `guidance`, `optional` and `repeat` sections are named.

| Id  | Severity | WCAG  | Finding and reproduction | Fix |
| --- | -------- | ----- | ------------------------ | --- |
| F6  | A        | 1.4.1 | **A directive callout without a label shows its type by colour only.** Note, info, tip, warning and caution differ only by the colour of the left border. There is no word or icon (screenshot of `:::callout{type=warning}` on the tour). Under forced colours even the border disappears, so the callout is indistinguishable from a paragraph. | `handlers.ts` `callout`: always emit the visible `p.callout-label` (the type's name, or `Type: label` when labelled), exactly as `blockquote` does for alerts. Point `aria-labelledby` at it instead of duplicating the text in `aria-label`. `prose.css`: give `.callout` a real `border` (not a background or shadow) so forced colours keep it. **Resolved 2026-10-17:** Every callout now shows its type in words (`p.callout-label`, for example "Warning") with a per-type icon masked from the label's colour. With an author label, a visually hidden "Tip: " prefix keeps the type. Under forced colours, a real `CanvasText` border (4 px at the start) and the icon stay. |
| F7  | A        | 1.3.1 | **A labelled callout's name drops its type.** `:::callout[Custom label]{type=tip}` gives `aria-label="Custom label"`, so a screen-reader user never learns it is a tip, while sighted users get the colour. | `handlers.ts` `callout`: name it `${Type}: ${label}`, following F6. **Resolved 2026-10-17:** Callouts and alerts are named by `aria-labelledby` pointing at the title (`callout.N`), so the name is "Tip: Custom label". |
| F21 | BP       | 1.3.1 | **In the editor, every callout tone looks the same** (screenshot: five identical grey boxes), although the `aria-label` says "Callout: note". Writers cannot see which tone they chose. | `packages/editor` directive node view and its styles: show the tone's name in the block's chrome and tint it with the same tokens as `prose.css`. **Resolved 2026-10-17:** **Not done here: reassigned.** The coordinator moved editor callouts to the writing-surface agent. The partial edit to `directive-view.ts` was reverted in full. |
| —   | BP       | —     | GitHub alerts are named twice: `aria-label="Warning"` and a visible "Warning" paragraph, so a screen reader says "Warning note, Warning…". | Use `aria-labelledby` on the label paragraph (the same change as F6). **Resolved 2026-10-17:** named once, by `aria-labelledby` on the title. |

### Tables (`:::table`, sticky clone, row headers, footer, caption, sort, stack, viewer)

**Structure.**
- `div.table-block > div.table-scroll[tabindex=0][role=group][aria-labelledby=caption | aria-label="Table"] > table > caption, colgroup, thead (th scope=col), tbody (th scope=row for row headers), tfoot`.
- Stack mode restates `role=table/rowgroup/row/columnheader/rowheader/cell`.
- The enhancer adds `button.table-sort` inside each header `th`, `aria-sort` on the `th`, a `p.table-announcement[role=status]`, the `aria-hidden` header and footer clones, and a `button.table-expand`.

**Passes.**
- The caption names both the table and its scroll group.
- `scope` is correct, and row headers and `tfoot` survive enhancement.
- The sort button sits inside the `th`, with `aria-sort` on the `th`, the same element.
- A sort is announced ("Sorted by Requests, ascending").
- The scroll region is focusable, and its ring is drawn on the card through `:has()`.
- The clone is `aria-hidden`, strips ids and sets its buttons to `tabindex=-1`.
- Stack-mode roles keep table semantics.
- The viewer is a native modal `<dialog>`, named by the caption. Focus moves to the dialog and Tab cycles Fit width, Copy as CSV, Copy as Markdown, Close, then the table. Escape closes it and focus returns to the expand button.
- "Fit width" uses `aria-pressed`.
- No duplicate ids while the viewer is open.

| Id  | Severity | WCAG   | Finding and reproduction | Fix |
| --- | -------- | ------ | ------------------------ | --- |
| F3  | A        | 4.1.2  | **Header links and footnote references end up inside the sort button.** `sortButton` moves all of the cell's children into the button. A header `Name [docs](…)` becomes `<button>Name <a href>docs</a></button>` (axe `nested-interactive`, probe document). Activating the link also sorts, and screen readers flatten the link. | `packages/design-css/src/tables/tables.ts` `sortButton`: when the cell contains `a[href]`, `button`, `input` or `[tabindex]`, leave the content in place. Append a separate icon button named `Sort by ${name}`, and still set `aria-sort` on the `th`. |
| F4  | A        | 4.1.2  | **The hanging header clone keeps links focusable.** `buildStrip` sets `tabindex=-1` on buttons only. Links (including a footnote reference) in the cloned `thead` stay in the tab order inside `aria-hidden="true"` (probe: `table-sticky-head focusable=A:docs,A:1`). While the header is stuck, Tab reaches invisible duplicates. | `tables.ts` `buildStrip`: set `tabIndex = -1` on every `a[href], button, input, select, textarea, [tabindex]` in the copy. (`inert` would also block the forwarding click the clone relies on.) |
| F5  | A        | 4.1.2  | **An empty header cell gets an unnamed sort button** (axe `button-name`, critical, corpus `13-readme-style`). | `tables.ts` `makeSortable`: skip cells whose text is empty, or name the button `Sort by column ${n}`. The renderer could also emit an empty header as `td` (`table-block.ts`). |
| F11 | AA       | 4.1.3  | **Viewer copy and sort announcements are not heard.** "Copy as CSV/Markdown" calls `announce()`, which writes to `.code-copy-status` on `<body>`. Sorting writes to `.table-announcement`, which stays in the original block when the scroller moves into the viewer. Both are outside the open modal `<dialog>`, whose top layer makes the rest of the page inert, and an inert live region is not announced. Neither control gives a visible confirmation either. Repro: open "Expand table", press Copy as CSV; the region fills (`Table copied as CSV`) outside the dialog. | `packages/design-css/src/code-blocks/copy.ts` `announce`: take an optional container and create or reuse a status region inside it. In `tables/table-viewer.ts`, pass `viewer.dialog`, and flip the control's own text to "Copied" for `COPIED_MS`, as the copy button does. In `tables.ts`, move the block's `.table-announcement` into the frame with the scroller (or give the viewer its own and route `sortBy` messages to whichever is live). |
| F14 | AA       | 1.4.11 | **The sort icon is faint.** The up and down triangles are the only visual sign that a header sorts, and at rest they are 0.3 opacity of the header colour: about 1.46:1 in light and 1.70:1 in dark. | `prose.css` `.prose .table-sort-icon::before/::after`: raise the resting opacity to at least 0.6 (or use `--color-muted` at full opacity). Keep the 1 / 0.15 contrast for the active direction. |
| F15b | BP      | 1.4.11 (forced colours) | **Under forced colours the sort arrows become two solid rectangles.** Transparent inline borders turn into `CanvasText`, so the direction can't be told apart (screenshot `forced-table-rowheaders`). | `prose.css`: inside `@media (forced-colors: active)`, draw the arrows with `forced-color-adjust: none; color: CanvasText`, or use an inline SVG icon. |
| F25 | BP       | 1.3.1  | **In stack mode, the column name is read twice.** `td::before { content: attr(data-label) }` becomes part of the cell's name ("Owner Platform"), and a screen reader also announces the column header "Owner". | `prose.css` stack block (around line 1430): `content: attr(data-label) / '';`. |
| F27 | BP       | 2.4.3  | **Every table is a tab stop, even when it does not scroll.** Each table adds one stop for its scroll group (11 extra stops on the tour), and every uncaptioned table is named "Table" (the-sync-map, table-showcase). | `tables.ts`: set or remove `tabindex` on `.table-scroll` from the overflow it already measures each frame (`overflowStart` or `overflowEnd`). `table-block.ts`: keep `role=group` only when captioned, or name an uncaptioned table from the nearest preceding heading. |
| —   | BP       | 2.4.3  | **The expand button comes after the sort buttons** in Tab order but sits above the table, in the card's corner. | Optional: insert `table-expand` before the scroller in `table-viewer.ts`. |
| —   | BP       | —      | **Sort buttons are named only by the column** ("Region"), with no hint that they sort. This matches the APG example, so it is acceptable. | Optional: `aria-description="Sort"`. |

### Code blocks and copy buttons

**Structure.**
- A plain block is `div.code-block > pre > code[data-lang][data-tokens]`.
- A titled block is `figure.code-block > figcaption.code-caption > span.code-title`.
- The enhancer appends `button.code-copy`, with `aria-label="Copy {Language} code"`, an icon, and `aria-hidden` visible text. Confirmation goes to one shared `div.code-copy-status[role=status][aria-live=polite]`.
- In the editor the block is `figure[aria-label="TypeScript code block"]` holding a CodeMirror `textbox` named "Code".

**Passes.**
- Each button names its language.
- Label in Name holds, because the visible "Copy" begins the name.
- Success and failure are announced. A refused copy selects the code and names the shortcut.
- The button appears on focus with a 2 px ring and is 28 px tall (2.5.8 passes).
- Highlight token contrast passes in both schemes (lowest is the light comment colour at 4.56:1).
- `figure`/`figcaption` titles name the figure.

| Id  | Severity | WCAG   | Finding and reproduction | Fix |
| --- | -------- | ------ | ------------------------ | --- |
| F2a | A        | 2.1.1  | **A scrolling `pre` is not focusable** (axe `scrollable-region-focusable`: the JSON block on the tour, and two code-group panels). Chrome 130+ auto-focuses it, but Firefox and Safari do not, and the content past the edge can't be scrolled by keyboard there. `prose.css` already styles `.prose pre:focus-visible`, so focusability was intended. | `packages/design-css/src/code-blocks/code-blocks.ts`: in the pass that gives each card its button, observe each `pre` (`ResizeObserver`). While `scrollWidth > clientWidth`, set `tabindex=0`, `role="region"` and `aria-label="{Language} code"`. Remove them when it fits. **Resolved 2026-10-17:** Added `code-blocks/scrolling-code.ts`, called from `enhanceCodeBlocks`. While a `pre` overflows, and only then, it gets `tabindex=0`, `role=group` and the name "TypeScript code, scrolls sideways". The ring is `.prose pre:focus-visible`, and the wrong comment about the renderer was corrected. A server cannot know what overflows. |
| F16 | BP       | 4.1.3  | **The first copy may not be announced.** `announce()` creates the live region on first use and writes to it on the next frame, and NVDA and JAWS often miss a region that is inserted and filled within a frame. | `copy.ts`: create the region when `enhanceCodeBlocks` runs (and in the editor's node-view factory), empty, before any message. |
| F17 | BP       | 2.4.6  | **Button names repeat.** On the code-groups page, four buttons are all "Copy TypeScript code". | `code-blocks.ts` `context.name` and `copy.ts` `offer()`: include the block's title when there is one ("Copy client.ts"). |
| F23 | AA       | 2.5.8  | **The editor's language field is 22.7 px tall,** and its neighbours are too close to qualify for the spacing exception (axe `target-size` ×5). | `packages/editor/src/code-block/language-field.ts` and `code-block-view.ts` toolbar styles: `min-height: 1.5rem` (24 px). |

### Code groups (no-JS stacked form and enhanced tabs)

**Structure.**
- Without script: `div.code-group[data-sync]` holds one `figure.code-block` per tab, captioned by `span.code-label` and an optional `span.code-title`.
- Enhanced: `div.code-group-header > div.code-tabs[role=tablist][aria-label="Code examples"] > button[role=tab][aria-controls][aria-selected][tabindex]`, then the copy button, then `div.code-panel[role=tabpanel][aria-labelledby][tabindex=0]` wrapping each card.

**Passes.**
- The no-JS form is fully readable, and each panel is captioned with its tab's name.
- The tablist is named. Tabs and panels are linked both ways.
- Panels are focusable (they contain no focusable element).
- The tab stop roves: Arrow keys, Home and End move and select (automatic activation), and Tab leaves the strip.
- A caption that only repeated the tab's name is hidden. Choosing a tab syncs the matching tabs in every group on the page without stealing focus.
- Tabs have a 2 px inset focus ring, and reduced motion removes the tab transition.

| Id  | Severity | WCAG                    | Finding and reproduction | Fix |
| --- | -------- | ----------------------- | ------------------------ | --- |
| F15c | AA      | 1.4.11 (forced colours) | **Under forced colours the selected tab can't be told apart.** Selection is drawn by a `::after` bar with a `background-color` (removed by forced colours) and a colour change (also removed). Screenshot `forced-dark-tabs`: eight identical labels. | `prose.css`: inside `@media (forced-colors: active)`, give `.code-tab[aria-selected='true']` a `border-block-end: 2px solid Highlight`, or set `forced-color-adjust: none` on the `::after` with `background: Highlight`. **Resolved 2026-10-17:** Under forced colours, the selected `.code-tab` is drawn `Highlight`/`HighlightText`, with its bar as a `HighlightText` border. |
| F15d | BP      | forced colours          | **Under forced colours, highlighted code looks selected.** `::highlight(quill-tok-*)` paints are drawn with the system `Highlight` colour (screenshot `forced-tabs`: purple bars behind every token). | `prose.css`: inside `@media (forced-colors: active)`, `::highlight(quill-tok-*) { color: CanvasText; background-color: transparent }`, or clear the highlights in `@quill/highlight/client` when `matchMedia('(forced-colors: active)')` matches. |
| F18 | BP       | 2.4.6                   | **Every group's tablist is called "Code examples"** (six on one page). | `code-blocks.ts` `enhanceGroup`: name the strip from the first panel's title or the nearest preceding heading, for example `Code examples: Install`. |
| F22 | A        | 4.1.2                   | **In the editor, panels lack `role="tabpanel"`.** The tabs' `aria-controls` point at plain `div`s with no role and no `aria-labelledby`. While a tab is renamed, an `input` sits directly inside the `tablist`. | `packages/editor/src/code-block/code-group-view.ts` `show()`: set `role="tabpanel"` and `aria-labelledby` to the tab's id on each panel. Render the rename field over the tab with `role=tab` kept on a wrapper. **Resolved 2026-10-17:** Each panel now has `role="tabpanel"` and `aria-labelledby` its tab. The rename field sits inside a `role="tab"` wrapper with the tab's id, so the tablist holds only tabs. Strip keys ignore events from inside the field. |
| —   | BP       | APG                     | Tab moves from the selected tab to the copy button before the panel. APG expects the panel next. This is acceptable, because the copy button belongs to the group. | Optional: place the copy button after the panels in DOM order and keep it visually in the header. |

### Diagrams (Mermaid slots, inline SVG, expand button, lightbox)

**Structure.**
- Mermaid: `div.diagram[data-diagram=mermaid] > pre > code`. The app draws it as `div.diagram-drawing > svg[role=img][aria-label="Diagram" | Mermaid's aria-labelledby]`, and the source becomes `display:none`. The public site does not draw Mermaid and shows the source.
- Inline SVG: `figure > div.diagram[data-diagram=svg] > svg[role=img][aria-label=alt]`, plus `figcaption` (from the image title).
- The enhancer prepends `button.diagram-expand[aria-label="Expand diagram: {alt}"]`.
- The lightbox is a native modal `<dialog aria-label="{alt}">` with Zoom out, the readout, Zoom in and Close.

**Passes.**
- Inline drawings carry a text alternative (the image's alt) and are captioned by `figcaption`, which also names the `figure`.
- The expand button is hidden until a Mermaid diagram has drawn, so it never does nothing.
- Lightbox: focus moves in, Escape closes, focus returns to the button, the drawing is moved rather than copied (no duplicate ids), and reduced motion removes its transitions.
- The `+`, `-` and `0` keys zoom.

| Id  | Severity | WCAG         | Finding and reproduction | Fix |
| --- | -------- | ------------ | ------------------------ | --- |
| F9  | A, AA    | 2.1.1, 2.5.7 | **Zoomed drawings can only be panned by dragging.** Open any diagram, press `+` twice (225 %), then press the arrow keys: `transform` is unchanged. There is no keyboard way to reach the part that zooming was for, and no single-pointer alternative to the drag. | `packages/design-css/src/lightbox/lightbox.ts`: map Arrow keys (with a step) to `pan`, and Home to `FIT`, in the dialog's `keydown`. Alternatively, make the zoomed stage a native scroll container (`overflow: auto`, canvas sized by scale), which gives keyboard, scrollbar and single-pointer panning for free. Add `aria-keyshortcuts` to the zoom buttons. |
| F10 | A        | 2.5.3        | **Label in Name fails on two controls.** The readout shows "100 %" but is named "Zoom: fit, or twice the size". The table viewer's "MD" is named "Copy as Markdown". A speech user saying "click 100 %" or "click MD" gets nothing. | `lightbox.ts`: name the readout from its text (`aria-label` = `${percent}%, fit or double`, updated with the readout), or drop `aria-label` and put the explanation in `title`/`aria-description`. `tables/table-viewer.ts`: show "Markdown" (or name the button "MD, copy as Markdown"). |
| F2b | A        | 2.1.1        | **A wider-than-column drawing scrolls but is not focusable** (axe ×4 on the-sync-map). The lightbox is the alternative way in, but at "fit" the labels are specks, which F9 makes unrecoverable by keyboard. | `lightbox.ts` `enhanceDiagrams`: while `scrollWidth > clientWidth`, give `.diagram` `tabindex=0` (with `role=group` and `aria-label` = the drawing's label). Fixing F9 also helps. **Resolved 2026-10-17:** The lightbox owner had added the overflow watch, but it never ran on the public site. `enhanceDiagrams(document)` read `document.ownerDocument`, which is `null`, so there was no ResizeObserver. That is now fixed, with a test. the-sync-map now has 0 `scrollable-region-focusable`, against 4. |
| F24 | A        | 1.1.1        | **A drawn Mermaid diagram has no real text alternative.** It is named "Diagram", and its source, which is a usable text alternative, is removed with `display:none`. Mermaid's `accTitle`/`accDescr` are honoured, but authors rarely write them. The expand button and dialog are also just "Expand diagram" or "Diagram", because `labelOf` runs before the drawing exists. | `apps/web/src/lib/diagrams/draw-diagrams.ts` `label()`: when the drawing has no Mermaid title, name it from the slot's `figcaption` when there is one. Point `aria-describedby` at the hidden `pre` (an id-referenced description works on `display:none` content), so the source is the long description. Offer a visible "Show source" toggle. In `lightbox.ts`, read the label when the button is pressed, not when it is created. **Resolved 2026-10-17:** `draw-diagrams.ts` names a drawing from Mermaid's own title, then the figure caption, then the source's front-matter `title:`, then "Diagram". The source moves into a closed `<details class="diagram-source">` "Diagram source" disclosure, linked from the SVG by `aria-details`. Reading the lightbox label when the button is pressed is left to the lightbox owner. |
| F29 | BP       | 2.4.6        | **Names are paragraph length.** The alt text becomes the expand button's and the dialog's name (≈ 230 characters on the-sync-map). The caption is shown in the dialog but not linked as its description. Gesture hints are `aria-hidden`, and the `+`/`-`/`0` keys are not documented anywhere. | `lightbox.ts` and `viewer/viewer.ts`: name the dialog from the caption when there is one, otherwise the first sentence of the alt. Set `aria-describedby` to the `.lightbox-caption`. Show a keyboard hint ("+ / − zoom, arrows pan") for `pointer: fine`. |

### Figures and cards

**Structure.**
- A titled image is `figure > img[alt] + figcaption`.
- `:::figure` is `figure > … + figcaption`. A figure around a single table becomes that table's `caption`.
- `:::cards` is `div.cards[data-variant] > section.card`.

**Passes.**
- Native figure and figcaption, with the figure named by its caption.
- An image without alt is `alt=""`, so it is decorative and never left unlabelled.
- A captioned table reads the same however it was written.
- Card sections have no names, so they create no region landmarks, and their headings carry the structure.

**Findings.** None.

### Badges, tenant labels, kbd and emoji

**Structure.**
- A badge is `span.badge[data-tone]` with text.
- A tenant label is `span.badge[data-label]`, led by a decorative emoji (`aria-hidden` span, or `img alt=""`) or a colour dot.
- A Unicode emoji is `span.emoji[role=img][aria-label="thumbs up"]`.
- A custom emoji is `img.emoji[alt=":airbnb:"][title]`.
- `:kbd[…]` renders as `kbd`.

**Passes.**
- Every badge and label carries its meaning in words, so colour is never alone (1.4.1).
- Badge text contrast passes in both schemes (no text node failed the manual check).
- The emoji leading a label is correctly decorative.
- Unicode emoji are named by their CLDR description, so they are not noise.

| Id  | Severity | WCAG  | Finding and reproduction | Fix |
| --- | -------- | ----- | ------------------------ | --- |
| F26 | BP       | 1.1.1 | **A custom emoji's alt is its shortcode with colons.** `:airbnb:` is read as "colon airbnb colon", and `:booking_com:` as "booking underscore com". | `packages/markdown/src/emoji/emoji.ts` `emojiMarkup`: `alt` = the name with `_` and `-` turned into spaces ("booking com"), or a description the organisation sets with the emoji. Keep the shortcode in `title`. |
| —   | BP       | —     | Under forced colours, badge pills lose their outline, but the text stays. | Optional: `border: 1px solid transparent` on `.badge`, so forced colours draw it. |

### Footnotes

**Structure.**
- A reference is `sup > a[href="#user-content-fn-x"][id][data-footnote-ref][aria-describedby="user-content-footnote-label"]`.
- The notes are `section.footnotes[data-footnotes] > h2.sr-only#user-content-footnote-label` then `ol > li#… > … a.data-footnote-backref[aria-label="Back to reference 1"]`.

**Passes.**
- References are described by "Footnotes", and back-references are named.
- `aria-describedby` is prefixed consistently with the id.
- `.sr-only` exists on both surfaces (computed: 1 × 1 px, `clip-path: inset(50%)`).
- Inline targets are exempt from 2.5.8.

| Id  | Severity | WCAG  | Finding and reproduction | Fix |
| --- | -------- | ----- | ------------------------ | --- |
| F20 | A        | 1.3.1 | **In the editor, a footnote reference is an empty `<sup class="footnote-reference" data-label="review" contenteditable="false"></sup>`** with no generated content. It is invisible and silent, so the reference is lost while editing (screenshot `editor-footnote`). | `packages/editor` footnote reference node view: render the number or label as text (`[1]`), as a link or button to the definition, named "Footnote 1". **Resolved 2026-10-17:** Added `packages/editor/src/footnote/footnote-view.ts`, which shows the number the reader will give: first-reference order, shared by repeat references. The number is a link named "Footnote N" to the note, which gets the id through a decoration, and following it puts the caret in the note. Numbers are recomputed only when a change adds a reference or removes a reference or note. |
| —   | BP       | 1.3.1 | When a footnote reference sits in a table header and the header is sortable, it ends up inside the sort button. | See F3. |

### Links (external, app and deep)

**Passes.**
- External links get `rel="noopener noreferrer"` and open in the same window, so no warning is required.
- Deep links (`#slug`) are rewritten to the prefixed ids and land below the bar (`scroll-margin-top`).
- App links (`/d/{id}`) are addressed by id.
- Link text is the author's.

| Id  | Severity | WCAG  | Finding | Fix |
| --- | -------- | ----- | ------- | --- |
| F32 | BP       | 2.4.4 | **Content links give no sign that they leave the site.** The header menu marks external links with an icon and visually hidden "(external)", but content links do not. | `packages/markdown/src/render/external-link-rel.ts`: append the same icon and `span.visually-hidden " (external)"` to external content links, and admit it in `sanitize-schema.ts`. Optional. |
| —   | BP       | 2.4.4 | **App links on the public site lead to sign-in.** `/d/{uuid}` links (system-overview, "Related") send a public reader to a sign-in page. This is product behaviour rather than accessibility, but the link's purpose is wrong for that audience. | `apps/server/src/public-site/pages.ts`: rewrite links to published documents to their public address, and leave unpublished ones as plain text. |

### Public-site chrome

**Structure.**
- A skip link, then `header` (banner) containing the lockup link, `nav[aria-label=Site]` (bar, with `details` dropdowns) and its compact twin (only one displayed at a time), `form[role=search]` with a visually hidden label, and `fieldset.site-scheme` with a legend and three radios.
- `details.site-menu > nav.site-nav[aria-labelledby]` with a visually hidden `h2` "Documents" and `aria-current="page"`.
- `main#site-main`.
- `nav.site-toc[aria-labelledby]` ("On this page").
- `footer`.

**Passes.**
- Landmarks are correct and named. The skip link works.
- The current page is marked with `aria-current="page"` (with weight, not colour alone), and the current section with `aria-current="true"`.
- Dropdowns close on Escape (returning focus to their summary), on focus leaving, and on an outside click.
- The scheme switch is a real radio group with a legend, and its focus ring is drawn on the visible label.
- Focus rings are 2 px accent, 6.04:1 (light) and 9.40:1 (dark).
- No horizontal scrolling at 320 or 640 CSS px on any page: header, tables (scroll inside their own region), stacked tables, tabs and diagrams all reflow.
- Reduced motion: `public-site.css` zeroes durations and `scroll-behavior` globally.

| Id  | Severity | WCAG   | Finding and reproduction | Fix |
| --- | -------- | ------ | ------------------------ | --- |
| F12 | AA       | 2.4.11 | **Focus lands under sticky chrome.** At 320 × 256, tabbing through the tour put 58 focused elements under the 101 px sticky header, many of them fully hidden: every `table-expand`, and the sort buttons of four tables. At 1280 × 900, Shift+Tab hid sort buttons and an expand button under the 61 px header, and a heading anchor under a table's stuck header. `scroll-margin-top` covers only headings and `[id]` in prose, and nothing sets `scroll-padding`. | `packages/design-css/src/public-site.css` (and the app shell's equivalent in `layout.css`): `html { scroll-padding-block-start: var(--anchor-offset); scroll-padding-block-end: var(--sticky-chrome-bottom, 0px); }`. For the table clone, `tables.ts` can scroll a focused real header cell clear of the stuck strip on `focusin`. **Resolved 2026-10-17:** `html { scroll-padding-block: var(--sticky-chrome-top) var(--sticky-chrome-bottom) }` is set in `public-site.css` and the app's `tokens.css`, because the app scrolls the window. The `.prose [id]` `scroll-margin-top` is reduced to just the air, so anchors still land at `--anchor-offset`. Focus walk on the public tour, forwards and backwards: 0 of 88 stops hidden at 320 × 256 and 0 of 105 at 1280 × 900, apart from the skip link, which is in the header. A stop under a table's stuck header clone is the tables agent's. `e2e/focus-not-obscured.spec.ts` covers both surfaces. |
| F30 | BP       | 1.4.10 | **The sticky header takes 40 % of a 320 × 256 viewport** (101 px, two rows). | `public-site.css`: `@media (max-height: 30rem) { .site-header { position: static } }`, and then let `--sticky-chrome-top` fall to 0. |
| F15e | BP      | forced colours | **Under forced colours the scheme switch shows no selection.** System, Light and Dark look identical, because the selection is a background on the label and the radios are `opacity: 0` (screenshot `forced-header`). | `public-site.css`: inside `@media (forced-colors: active)`, `.site-scheme input:checked + span { outline: 2px solid Highlight }` or `forced-color-adjust: none` with `Highlight`/`HighlightText`. **Resolved 2026-10-17:** Under forced colours, the checked scheme is drawn `Highlight`/`HighlightText`. Computed under emulation: rgb(55,0,110) against transparent for the others. |
| F31 | BP       | 2.4.6  | **The sidebar names itself twice and its count has no unit.** The `details` summary says "Documents" and the `nav`'s hidden `h2` says it again. The section summary reads "Architecture 6", with no word for what the 6 counts. | `templates/navigation.ts` and `page.ts`: add a visually hidden " documents" after the count. Drop the hidden `h2`, or name the nav by the summary. |

### Cross-cutting checks

| Check | Result |
| ----- | ------ |
| **Colour contrast (manual)** | Body, muted, caption and badge text all pass in both schemes. Failures: F13 (heading anchor, 3.33:1 light) and F14 (resting sort icon, 1.46:1). Code tokens pass (light 4.56–6.59:1, dark 5.94–7.71:1). Inline code, the copy icon (4.57:1 light) and the focus ring pass. |
| **Forced colours** (light and dark) | Losses: task-checkbox state (F15a), selected tab (F15c), sort direction (F15b), callout boundary (F6), scheme selection (F15e), token highlights look selected (F15d), badge outlines. Neither stylesheet has an `@media (forced-colors: active)` block. Inline SVG drawings keep their own palette, which follows `prefers-color-scheme`, and stay legible. |
| **Reduced motion** | Pass. Tabs, copy, lightbox, canvas, expand buttons and hint animation are all reduced in `prose.css`, and the public site zeroes durations globally. The remaining fades are opacity only. |
| **Zoom and reflow** (200 % = 640 px, 400 % = 320 px) | Pass for 1.4.10: no page scrolls horizontally, and wide tables and diagrams scroll inside their own regions. Usability problem: F30. |
| **Focus visibility** | Pass. Every stop has a 2 px ring (the table group's ring is on its card). Hover-revealed controls become opaque on `:focus-visible`. |
| **Duplicate ids** | None, before or after enhancement, or with the viewer or lightbox open. |
| **Landmarks and headings** | Correct landmarks on both surfaces. One `h1`. On the public site the hidden "Documents" `h2` comes before the `h1`, which is acceptable. Author-level heading skips occur in corpus 10 and 12 only. |

## Prioritised fix list

Ordered by user impact and the number of pages affected, then cost. Severity is in brackets.

1. **F1** [A]: name task-list checkboxes. `handlers.ts` and `sanitize-schema.ts`. Every task list, both surfaces.
2. **F12** [AA]: add `scroll-padding` for the sticky chrome. `public-site.css` and `layout.css`. One rule fixes most 2.4.11 failures.
3. **F3, F4, F5** [A]: sort buttons. `tables.ts` (`sortButton`, `buildStrip`, `makeSortable`). Stops links in headers being nested, ends focusable content in the `aria-hidden` clone, and names empty headers.
4. **F6, F7** [A]: show the callout type in words and include it in the name. `handlers.ts` `callout`, `prose.css`.
5. **F19, F20** [A]: editor task-item checkbox and footnote-reference node views. `packages/editor`.
6. **F2a, F2b** [A]: make overflowing `pre` and `.diagram` focusable and named. `code-blocks.ts`, `lightbox.ts`.
7. **F9, F10** [A, AA]: keyboard and single-pointer panning in the lightbox; Label in Name for the zoom readout and "MD". `lightbox.ts`, `table-viewer.ts`.
8. **F11** [AA]: route viewer announcements to a live region inside the dialog. `copy.ts` `announce`, `table-viewer.ts`, `tables.ts`.
9. **F24** [A]: a text alternative for drawn Mermaid. `draw-diagrams.ts`, `lightbox.ts`.
10. **F22** [A]: editor code-group `tabpanel` roles. `code-group-view.ts`.
11. **F15a–e**: one `@media (forced-colors: active)` block in `prose.css` and one in `public-site.css` (checkbox, selected tab, sort arrows, token highlights, callout border, scheme switch).
12. **F13, F14** [AA]: anchor colour and resting sort-icon opacity. `prose.css`.
13. **F23** [AA]: 24 px editor language field. `language-field.ts`.
14. **F8** [BP]: heading names. Move the anchor outside the heading in `handlers.ts`, and use `content: '#' / ''` in `prose.css`.
15. **F16, F17, F18, F25, F26, F27, F29, F30, F31, F32, F21** [BP]: create the copy live region early; title-specific copy names; tablist names; stack-label alt text; custom emoji alt; tab stops only for tables that scroll; shorter dialog names and keyboard hints; unstick the header on short viewports; sidebar wording; external-link marker; editor callout tone.

Each fix should land with its test, as rule 17 requires. Most of them are DOM assertions in the existing `*.test.ts` beside each module (`tables.test.ts`, `code-blocks.test.ts`, `lightbox.test.ts`, `render.test.ts`). An axe run in `reading-blocks.test.ts` over the corpus would catch F1, F3 and F5 from now on.
