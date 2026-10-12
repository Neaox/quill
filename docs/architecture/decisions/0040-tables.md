# ADR-040: Tables

**Status:** Accepted. Phase 1 (reading) is built; Phase 2 (the editor) is designed here and built later.
**Date:** 2026-10-11
**Related:** ADR-002 (Markdown is canonical), ADR-003 (editor architecture), ADR-011 (security baseline), ADR-027 (block layout widths), ADR-031 (render caching), ADR-033 (compatibility), ADR-036 (diagrams and reading blocks: tables are `wide` by default), ADR-039 (Markdown extensions)

## Context

People who come to Quill from Confluence like its tables more than almost anything else in it, and they also know exactly where those tables let them down. The complaints that come up again and again are these:

1. **Sticky headers break.** The header row stops sticking inside page layouts and nested tables, in any table that scrolls sideways, and with merged cells.
2. **Nothing else can be frozen.** There is no frozen first column for a wide table.
3. **"You can't sort a table with merged cells."** Usually there are no visible merged cells at all: the merges are phantom ones that came in when the table was pasted from Excel.
4. **Resized column widths reset.** Widths someone set by dragging come back wrong after an edit, a paste or a move between editors.
5. **Two width modes confuse people.** Readers cannot predict how the "fixed" and "responsive" modes will behave, and a fixed table is clipped on a small screen.

Quill's tables are GFM tables (ADR-002). Each one is rendered in a focusable scroll container, drawn as a card, and is `wide` by default (ADR-036). Their widths come from the reading grid (ADR-027), which has three tracks, `content`, `wide` and `full`. A centred layout breaks out on both sides, and a start-aligned layout (`data-align="start"`) breaks out to the right only. The tables had no sorting, no frozen parts and no column widths. On the public site, a header made sticky inside the scroller stuck to the scroller rather than the page, which is the same bug as Confluence's first complaint.

This ADR covers both phases. Phase 1 is the reading surface: storage, rendering and the reader's tools. Phase 2 is the editor.

## Decision

### Storage: an optional wrapper around a GFM table

```text
:::table[Latency budgets]{width=70% columns="2fr 3fr 1fr" headers=both footer=1 freeze=header,first-column responsive=stack sort=off caption=bottom}
| Service | What it does                       | Latency |
| :------ | ---------------------------------- | ------: |
| Gateway | Routes every request to its region |   12 ms |
| Total   |                                    |   12 ms |
:::
```

- **The wrapper is optional, and so is every attribute.** A bare table renders exactly as one wrapped with no attributes. Outside Quill the wrapper disappears and what remains is a plain GFM table (ADR-002).
- **It wraps exactly one table.** A wrapper around anything else gets a warning and its contents are shown as written.
- **One definition** lives in `packages/markdown/src/directives/table.ts`, following the pattern of the other directives (ADR-004): the syntax it claims, a model, `validate` and `serialize`. It is shaped to move behind `MarkdownExtension` (ADR-039). The sanitiser grant is built from the definition's own constants (`TABLE_PERCENTS`, `TABLE_FROZEN_PARTS`, `CELL_LABEL_LIMIT`).

| Attribute | Values | Default (absent) |
| --- | --- | --- |
| `width` | `content`, `wide`, `full`, or a whole percentage `1%` to `100%` | `wide` (ADR-036) |
| `columns` | One proportion per column, `Nfr` or a bare positive number | The browser's automatic layout |
| `freeze` | `header`, `first-column`, `footer`, several separated by commas, or `none` | Automatic (below) |
| `responsive` | `scroll` or `stack` | `scroll` |
| `headers` | `column`, `row` or `both` | `column` |
| `footer` | A number of rows, `1` to `999` | `0`, no footer |
| `sort` | `on` or `off` | `on` |
| `caption` | `top` or `bottom` | `top` |
| `[label]` | The caption, inline Markdown | None |

**Parse.** One pass (`readTableOptions`), shared by `parse` and `validate` so they cannot disagree, reads each known attribute. An unknown attribute is kept in the model's `other` field, and so is a known one whose value cannot be read. Both are written back unchanged (AGENTS.md rule 7).

**Validate.** Problems are warnings, never errors, because a table always renders. The rules are:
- a width that is not one of the three names or a whole percentage from 1 to 100;
- column widths that are not positive proportions, which includes anything in pixels;
- a number of column widths that does not match the number of columns (the widths are then ignored);
- a freeze part that is not known, or that repeats, or `none` written alongside a part;
- a responsive mode that is not `scroll` or `stack`;
- a sort value that is not `on` or `off`;
- a `headers` value that is not `column`, `row` or `both`, or a caption side that is not `top` or `bottom`;
- a footer that is not a whole number of rows, or that is taller than the table (every row is then the footer);
- a body that is not exactly one table.

**Serialize.** The caption is written back as the label. Known attributes are written first, in the fixed order `width columns headers footer freeze responsive sort caption`. Defaults are left out. After them come the attributes the definition did not read, in the order they were written. The editor's round trip carries the directive whole (`containerDirective` in the ProseMirror schema), so a document opened and saved keeps its attributes byte for byte. The corpus file `23-tables.md` holds that in place.

**`columns` stores proportions, never pixels.** A proportion means the same thing in a 600-pixel column and a 1,400-pixel one, on a phone and in an export. Pixel widths are exactly what makes Confluence clip a fixed table on a small screen. The renderer turns proportions into percentages on a `<col width>`. That is a presentational hint, because the page's Content Security Policy admits no `style` attribute. `table-layout: fixed` honours the proportions exactly where there is room. Below a 40rem table the proportions become hints, and the table lays itself out from its content and scrolls.

### Width semantics

- **No wrapper means `wide`**, as ADR-036 already says. `content`, `wide` and `full` span the reading grid's named tracks.
- **A percentage is a share of the full track**, which is the grid's whole width and is measured in container units (`cqi`). It is clamped: never narrower than the reading measure and never wider than the room available.
  - **Centred layouts:** the table is centred in the full track.
  - **Start-aligned layouts:** the table starts on the text's left edge and grows to the right only, so a table never sticks out to the left of the prose beside it.
- **Steps of five.** The renderer rounds a percentage to the nearest step of 5 (`data-percent`), and the stylesheet holds one rule per step. CSS has no portable way to read a free number out of an attribute, and inline styles are refused. The Markdown keeps the author's exact number. The editor's free width handle moves in the same steps (Phase 2).
- **Small containers.** Below 48rem every width collapses to the single column, as it does for every block (ADR-027). Between 48rem and 64rem, `wide` becomes `full`.
- **Nesting.** A table inside `:::wide` or `:::full` follows its wrapper, because it is no longer a direct child of the grid.

### Rendered markup (render version 6)

```html
<div class="table-block" data-width="percent" data-percent="70" data-headers="both" data-freeze="header first-column" data-responsive="stack" data-sort="off" data-caption="bottom">
  <div class="table-scroll" tabindex="0" role="group" aria-labelledby="user-content-caption.1">
    <table>
      <caption id="user-content-caption.1"><span class="table-caption-text">Latency budgets</span></caption>
      <colgroup><col width="33.33%">…</colgroup>
      <thead>…</thead><tbody><tr><th scope="row">Gateway</th><td>…</td></tr></tbody><tfoot>…</tfoot>
    </table>
  </div>
</div>
```

Without a caption, the scroll region is named "Table" (`aria-label`, the only value the sanitiser admits there). With one, it is named by the caption through `aria-labelledby`, so the caption's words never enter an attribute.

`.table-block` is the card and the grid item. `.table-scroll` scrolls sideways inside it. The block exists so that something *outside* the scroller can stick to the page. Attribute values are enumerated or patterned in the sanitiser, and `tables.security.test.ts` attacks each one.

### The reading surface (Phase 1)

**A frozen header row that really sticks.** An element with `overflow-x: auto` is a scroll container on both axes. A `position: sticky` header inside it therefore sticks to the scroller, which never scrolls vertically, and not to the page. That is the core of Confluence's bug.

The reader script (`packages/design-css/src/tables/tables.ts`) hangs a copy of the header in a zero-height sticky strip in the block, just above the scroller:
- The copy's column widths come from the real header, and it moves sideways with the scroller.
- The block's `overflow: clip` rounds the card's corners without becoming a scroll container, and cuts the copy off at the table's foot.
- The copy is `aria-hidden` and out of the tab order. The real `thead` stays the accessible header, and a click on the copy's sort button sorts through the real one.
- The copy is shown only while the real header has scrolled under the top bar (`data-stuck`). Below the bar, it stops at `--table-sticky-top`.

Freezing is automatic for a table taller than the viewport. `freeze` turns it on or off explicitly.

A pure-CSS alternative was considered and rejected; see the alternatives below.

**A frozen first column.** `position: sticky; inset-inline-start: 0` inside the scroller works, because that is the axis the scroller scrolls. It is pure CSS, so it also works without JavaScript.
- **When:** always with `freeze=first-column`, and by default when a table is narrower than 40rem.
- **The edge:** the column always shows a hairline at its edge. While scrolled, it also shows a subtle shadow: the start scroll shadow falls at the frozen column's measured edge (`--table-frozen-width`).

**Scroll shadows.** Gradient shadows at either side say there is more to scroll to.
- Where the browser supports scroll-driven animations (`animation-timeline` on a named `scroll-timeline`, with `timeline-scope` on the block), the scroller's own scroll position draws them.
- Elsewhere, the reader script sets `data-overflow-start` and `data-overflow-end` on the block.

**Click-to-sort for readers.**
- **Controls.** Each header's text becomes a `<button>` inside the `th`. Pressing it sorts ascending, then descending, then back to the order as written.
- **Accessibility.** `aria-sort` sits on the sorted `th`, and a polite `role="status"` region says what happened ("Sorted by Budget, ascending").
- **How values compare.**
  - A column whose every non-empty cell is a number sorts as numbers.
  - A column whose every non-empty cell is a date sorts as dates: ISO dates, or dates with the month named.
  - Anything else sorts as text with `Intl.Collator(lang, { numeric: true })`.
  - Empty cells go last in both directions, and the sort is stable.
- **The document never changes.**
- **Turning it off.** `sort=off` removes sorting. A table with fewer than two rows has no sorting.
- **Merged cells.** Sorting can never be blocked by "merged cells", because GFM has none. Phase 2 makes sure that stays true after a paste.

**Responsive.**
- **`scroll` (the default):** the table scrolls sideways, with the first column frozen on a narrow table.
- **`stack`:** below a 36rem table (a container query on the block), each row becomes a group of label and value pairs. The labels are the column names, which the renderer emits as `data-label` on every `td` (at most 80 characters), so stacking works without JavaScript. The header row stays as a line of column names, and those names are the sort buttons. A stacked table carries explicit `table`, `rowgroup`, `row`, `columnheader` and `cell` roles, because some browsers drop table semantics from elements restyled with `display: block`.

**Numbers.** A column whose body cells are all numbers is marked `align-numeric` by the renderer, on the server, unless its author set an alignment. Blank cells and dash placeholders do not count against it. A number may carry a sign, a currency, thousands separators, decimals, a percentage or a short unit. The column is set flush right in tabular figures and never wraps a number. The author's own alignment classes (`align-left`, `align-center`, `align-right`) are now styled too; they never were before.

**Without JavaScript.** There is no sorting and no hanging header. Everything else works and nothing breaks: widths, column proportions, numeric alignment, stacking, the CSS sticky first column, and scroll shadows wherever scroll-driven animations exist.

**Performance.**
- **One listener and one observer:** a single captured, passive scroll listener and a single `ResizeObserver` cover every table under a root.
- **One frame of work:** at most one frame of work per frame. Every layout read for every table happens first, then every write, and a frame writes only what changed.
- **Lazy reading:** rows are read only when a reader first sorts by a column.
- **A guard in the tests:** a test sorts a 1,000-row table, with a time budget that catches quadratic work.
- **Size:** the reader bundle grows by about 7 KB minified.

**Print.** On paper there is no scrolling, no copy of the header and no shadows.

### Row headers, footers and captions

**Row headers.** GFM has none, so `headers` says which cells head the table:
- **`column`** (the default): the header row heads the columns.
- **`both`**: the first cell of every body and footer row is also a `<th scope="row">`, which a screen reader announces as the row's name.
- **`row`**: only the first cells head; the GFM header row is read as an ordinary first row. Outside Quill it still looks like a header row, which reads fine.

Row headers are frozen at the left while the table scrolls sideways, which is the same mechanism as `freeze=first-column`, so the two never need writing together. `freeze=none` unfreezes them. The top-left cell sits above both the frozen header row and the frozen column, in the header's tone.

The bold first column under the `plain` and `cards` rules is a look only, and says nothing semantically. A first column that really heads its rows is written `headers=row` or `headers=both`.

**Footers.** `footer=N` makes the last N rows the footer, rendered in a `<tfoot>`. Its cells keep their `th` and `td` roles, and a totals row usually opens with a row header. Outside Quill the footer rows are just the last rows.
- **Never sorted.** Sorting reorders the body only, so totals never sort into the data, which is a classic bug elsewhere. A test holds this.
- **Styling.** A stronger rule above the footer, the header's tone on the surface, and numbers still aligned in tabular figures.
- **Frozen.** `freeze=footer` keeps it at the bottom of the viewport while any part of the table is in view, mirroring the header: a copy hangs in a sticky strip after the scroller. It is automatic for a table taller than the viewport.
- **Stacked.** On a phone, the footer is a last, summary card.

**Captions.** The label is the caption: `:::table[Latency budgets by region]{…}` renders a real `<caption>`, which is the table's accessible name. It also names the scroll region, through `aria-labelledby` pointing at the caption's prefixed id.
- **Position.** Above the table by default, as a data table's title reads. `caption=bottom` sets it below as a quieter note.
- **Wide tables.** The caption's words are held at the card's left edge while a wide table scrolls under them.
- **Stacked.** The caption stays above the cards.
- **`:::figure` (ADR-036).** A figure holding exactly one table, bare or in a `:::table` without its own caption, gives its figcaption to the table as its `<caption>`. The figure element is not kept, so the two ways of writing a caption render identically, and a test holds that.

### Sticky chrome

One pair of custom properties says how far the page's own sticky bars reach into the viewport: `--sticky-chrome-top` and `--sticky-chrome-bottom`. Every hanging copy stops there, and the anchor scroll offset (`--anchor-offset`) is derived from the top one, so the two can never disagree. Each shell sets them once, from its own bars:
- **The application:** `--sticky-chrome-top` is `--spacing-shell-header`, a token, so nothing runs.
- **The public site:** its header wraps onto a second line when the menu folds. The reader script measures the header with a ResizeObserver (`sticky-chrome.ts`). Before it runs, the stylesheet's estimate is the one-line header.
- **Presentation mode:** there is no bar, so the top is `0`.
- **The reader preview:** its banner floats at the foot of the window and covers nothing at the top.
- **The bottom:** `--sticky-chrome-bottom` is the safe-area inset by default, so a phone's home indicator never covers a frozen footer.

### Full screen

Every table opens full screen, as a diagram does, in one shared viewer (`packages/design-css/src/viewer/viewer.ts`). It owns:
- the native `<dialog>`, its focus handling and focus return;
- the backdrop that closes it, and `html.lightbox-open`;
- the floating controls, the caption footer, and the gesture hint with its "turn your phone" variant.

The diagram lightbox and the table viewer are its two callers, and the lightbox's tests prove the refactor changed nothing.

**Opening.** An expand button on the card ("Expand table: <caption>") opens the viewer. The button is shown on hover and focus, and always on touch.

**Inside the viewer:**
- **The table itself.** Its scroller is moved into the viewer and back, so sort state, sort buttons and ids stay single. A sort made in the viewer is still there when it closes.
- **Sticky parts.** The stage is the one scroll container, so the header row, the row headers and the footer stick in plain CSS.
- **No zooming.** Tables scroll; they do not zoom. "Fit width" shrinks the table to the stage on request (CSS `zoom`).
- **Controls.** The controls sit in a row of their own, so they never cover the header row. "Copy as CSV" (RFC 4180) and "Copy as Markdown" (GFM, alignment kept) copy the table as shown, sorted or not. They use the code blocks' shared clipboard helper and announcement region (`code-blocks/copy.ts`).
- **The hint.** On a touch screen held upright, a table wider than the viewport, measured by its `scrollWidth` and not a view box, shows the turn-your-phone hint.

### Done means the showcases too

A table change is done only when three places show it, updated in the same change:
- **The design page:** each feature's specimen on `/design`.
- **The reading surface tour:** the "Reading surface tour" development document, through the API or the editor.
- **The fidelity corpus:** `packages/markdown/corpus/23-tables.md`, which holds every `:::table` attribute value and round-trips them.

### The editor (Phase 2)

The bar is Confluence's table editor at its best, without its known faults. The editor edits the GFM table and the wrapper's attributes, and never stores anything Markdown cannot hold. Every operation below is one ProseMirror transaction, so **every one of them can be undone** with one undo, including a paste, a drag and a resize.

**Resizing.**
- **Table width handle.** A handle on the table's trailing edge. While dragging, a live readout shows "Content", "Wide", "Full" or "70%". The handle snaps to the content, wide and full tracks, and between them moves freely in steps of 5%. It writes `width`.
- **Column border handles.** Each border between columns has a handle. Dragging it shows a live readout of both neighbours' shares and writes `columns` as proportions, rounded to sensible fractions. Holding Shift resizes the neighbour proportionally. A double click resets the column to automatic.
- **No jank.** While a drag is in progress, the drag moves a CSS transform on an overlay guide and a `colgroup` preview inside one animation frame. The document is committed once, on release. Nothing reflows the page while the pointer moves, and the commit is one transaction.

**A floating table toolbar.** One toolbar is shared with text, links and callouts (`packages/editor/src/toolbar`); it hangs above the table's top edge, is held below the page's chrome while a tall table passes under it, and offers what is about the thing the author is pointing at, as icons named by their labels:
- **A caret in a cell, or a patch of cells, is pointing at the table.** It holds the alignment of the selected columns (left, centre, right), a "Table settings" menu, and removal of the table. The menu holds the width (Content, Wide, Full), the header row, header column, footer row and caption (`headers`, `footer`, the label), what is kept in view for readers (`freeze` header, first column), cards on phones (`responsive`) and whether readers may sort (`sort`). Each item says what it does and whether it is on.
- **A whole row picked out by its grip is pointing at that row.** It holds insert above and below, move up and down, and delete.
- **A whole column picked out by its grip is pointing at that column.** It holds insert left and right, move left and right, alignment and delete.

Every control is a labelled button with a visible focus ring, its state as a real attribute (`aria-pressed`, `aria-expanded`, `disabled`). The toolbar is entered with Alt+F10, moved along with the arrow keys, and left with Escape. Insert, move, align and delete are in the context menu too.

**Row and column handles.** A grip straddles the top edge for each column and the leading edge for each row, and is visible while the pointer or the caret is in the table. From a grip you can:
- select the row or column, which makes it what the toolbar is about (the grip turns to the accent colour while it is selected);
- drag it to reorder.

A "+" sits on every border between lines and on the outer edges (never above the header row). It is a dot until the pointer comes near, then a button with a guide across the table showing where the line will go. Pressing it inserts the line there with the caret in its first cell, in one transaction.

While dragging, the moving row or column is drawn as a translucent overlay, and a drop line shows where it will land. Grips are reachable by keyboard: Alt+Arrow moves the selected row or column. Alt+Shift+Arrow moves the caret to the neighbouring cell in that direction, at its start, without stepping through the text first (the plain arrows go a character, Ctrl+Arrow a word, and Tab follows reading order); at the table's edge it does nothing.

**Header row, header column and numbered rows.**
- **Header row:** GFM always has a header row. Turning the toggle off makes the first row an empty header. The editor shows such a row collapsed, as an "untitled columns" strip, and the reader shows it hidden.
- **Header column:** writes `headers=both`, or `headers=row` with the header row off. The reader renders the first cell of each row as `<th scope="row">`.
- **Footer row:** writes `footer=1`, and more rows by dragging the footer's top edge.
- **Caption:** an editable line above the table, written back as the directive's label.
- **Numbered rows:** stored as `numbered`. The reader draws the numbers with CSS counters, and the numbers follow a reader's sort.

**Keyboard.**
- Tab and Shift+Tab move to the next and previous cell. Tab in the last cell adds a row.
- Enter in the last row adds a row below.
- Shift+Enter is a line break inside a cell (`<br>`, which GFM keeps).
- Arrow keys cross cell boundaries at the edge of a cell's text.
- Escape selects the whole table.

**Clean paste from Excel and Google Sheets.** A paste reads the clipboard's HTML and plain text, and builds a plain GFM table from the visible grid:
- **No phantom merges.** A `colspan` or `rowspan` that only repeats an empty cell is unwound, and so are the hidden columns and empty trailing rows that spreadsheets include. A real merge is unwound into repeated or empty cells, and a notice says so, because GFM cannot merge.
- **Content.** Bold, italic, links and line breaks are kept. Spreadsheet styles, fonts and colours are dropped.
- **Numbers and dates** keep their displayed text, so "1,250.50" stays as written. Numeric columns are then right-aligned on their own.
- **Into a cell.** Pasting a grid into a cell fills the cells from there, adding rows and columns as needed, in one transaction.

**Undo.** As above: every operation is one transaction, and undo restores the selection.

### How Phase 2 avoids Confluence's editor complaints

| Complaint about Confluence | How Quill avoids it |
| --- | --- |
| Column widths reset after an edit or a paste | Widths are proportions in the document (`columns`), never measured pixels, so they survive edits, pastes and export. Inserting a column keeps the other proportions and gives the new column the average. |
| Phantom merged cells from Excel stop sorting | There are no merges to store (GFM), and paste unwinds them on the way in. |
| Fixed versus responsive width mode confusion; fixed tables clipped on phones | One model: a width (a track or a share of the full one) plus proportional columns. On a narrow screen it always scrolls or stacks, and never clips. |
| Sticky headers fail in layouts, nested and scrolling tables | The reader hangs a header copy outside the scroller, which works whatever the table is inside. The editor uses the same mechanism for its own header. |
| Hard to select a whole row or column, or to reorder | Grips select, insert and drag. Alt+Arrow moves rows and columns by keyboard. |
| Resizing drags are jumpy, and the page reflows | Drags preview on an overlay and commit once on release. |
| Undo skips or splits table operations | Every operation is exactly one transaction. |
| Toolbar covers the content | The toolbar is a short row of icons that hangs above the table's edge, never over its cells, and flips below the table when there is no room above. Everything rarer is in its settings menu. |

## Alternatives considered

- **HTML tables in Markdown.** These would allow merges, column widths and attributes. They were rejected:
  - Raw HTML is escaped to text by design (ADR-011).
  - Nothing outside Quill could edit them as Markdown.
  - They would bring back merged cells, and with them the sorting failures this ADR exists to avoid.
- **Storing pixel widths.** These are what Confluence stores, and they are behind both "widths reset" and "fixed tables clip". A pixel width means different things in the reader, the editor, a phone and an export. Proportions plus a track width express what an author means.
- **Confluence's fixed and responsive dual mode.** Two modes with different rules for the same table confuse people. One model, a width and proportional columns, covers both.
- **Pure-CSS sticky headers.** The ways to get one all fall short:
  - **Sticky `thead` cells inside the scroller.** These stick to the scroller, not to the page. This is the bug itself.
  - **`overflow-x: clip` instead of `auto`.** This would let the header stick to the page, but it gives up sideways scrolling, which wide tables need.
  - **A height-limited scroller (`max-height: 80vh`)** with a header that sticks inside it. This nests scrolling inside the page. That is awkward on a phone and on a trackpad, and the table is never seen whole.
  - **Scroll-driven animations alone.** These cannot move an element to follow the page's scroll, because they need the page as the timeline and the table's offset in it.

  None of these works in Chrome, Safari and Firefox without one of those costs, so the header copy is the robust choice. It is enhancement only, and without it the real header still scrolls normally.
- **Sorting on the server, or sorting by query string.** This would change the cached body (ADR-031) and the document's identity for an interaction that is only a reader's own view.

## Consequences

- Render version 6. Old bodies are re-rendered, never patched (ADR-031, ADR-033).
- The reading surface works in the app, in the reader preview and on the public site. All three share one enhancer (`@quill/design-css/tables`), which the public reader script bundles.
- `KNOWN_DIRECTIVES` gains `table`. The editor carries the wrapper unchanged until Phase 2 gives it a view.
- The table's card moves from `.table-scroll` to `.table-block`. A bare `.table-scroll`, from an old body or a React `ProseTable`, is still drawn as the card.
- Phase 2 adds `numbered` as a reading attribute. Until then, it is an unknown attribute and is preserved.
- The diagram lightbox is now one caller of the shared viewer; the table viewer is the other.
- `--sticky-chrome-top` and `--sticky-chrome-bottom` are the one source for how far the page's sticky chrome reaches, and `--anchor-offset` is derived from them.
