# Performance architecture

How Quill stays responsive: in the editor above all, and across the application.
The numbers are the budgets in `quill-plan.md` section 31. This document is how
we meet them, and the rules every feature is designed against (AGENTS.md rule
13: performance is a requirement, not a follow-up).

**The core rule.** The cost of anything a person does is proportional to what is
on screen and what changed, never to the size of the document, the workspace or
the organisation. Work that genuinely has to touch everything runs off the main
thread, or in slices short enough that input always comes first. And the person
always knows what is happening.

Each section says what is **in place** (with the file that does it and the
guard that keeps it) and what is **planned**, so this document is never mistaken
for a description of work that does not exist yet.

## 1. Budgets and how they are kept

| Interaction | Budget | Guard |
|---|---|---|
| Keystroke | median under 16 ms input-to-paint, p95 under 33 ms, on a 1,200-block document in a production build | `packages/editor/src/document/keystroke-budget.test.tsx` (document walks and layout reads per transaction); measured with Chrome traces |
| Enter (new block) | p95 under 33 ms | being brought in by the reading-rhythm work (section 3) |
| Any main-thread task | under 50 ms | idle-queue tasks are timed in `paste-budget.test.tsx` |
| Feedback for anything slow | something visible within 100 ms; progress plus cancel past 1 s | section 7 |
| Paste, open, save, merge | `quill-plan.md` section 31 | `paste-budget.test.tsx`, `merge-performance.test.ts` |

jsdom guards count work: conversions, walks, layout reads, CodeMirror views.
They cannot measure time honestly, so time is measured in a real browser on a
**production build**. Today that is a scripted Playwright and Chrome-trace run.
Planned: the same run in CI (section 9).

## 2. The editor: why there is no virtualisation

ProseMirror renders the whole document into the DOM. Viewport rendering, as
CodeMirror does it, is deliberately out of scope for the library
([discussion](https://discuss.prosemirror.net/t/efficient-viewport-rendering-like-codemirror/577)).
Profiling in the community points at the browser's layout and paint of a large
page as the cost, not ProseMirror's own work
([thread](https://discuss.prosemirror.net/t/performance-issues-with-prosemirror-and-chrome/2498/10)).
ProseMirror's per-edit work is already proportional to the change: nodes are
immutable and shared, so the view only redraws what changed.

**True virtualisation (blocks off screen not in the DOM) would cost:**

- **The browser's find (Ctrl+F)** cannot find text that is not in the DOM.
  Quill's own find and replace is unaffected for *finding*, because it searches
  the document model, but it would have to mount a match before highlighting it.
- **Native selection.** A DOM selection cannot end in content that is not drawn,
  so shift-click, drag-select and select-to-end across a gap break, along with
  spellcheck and IME composition near the gap.
- **Assistive technology.** Screen readers navigate by the DOM. Absent content
  breaks reading order, heading navigation and landmark counts.
- **Heights.** Unrendered block heights are guesses, so the scrollbar and
  anchoring jump.

**What Quill does instead** keeps every block in the DOM and stops the browser
from *working* on blocks that aren't visible:

- **`content-visibility: auto` on every top-level block of the writing surface**
  (`packages/ui/src/styles/editor.css`, guarded by
  `packages/ui/src/styles/editor.test.ts`). The browser skips layout, paint and
  compositing for off-screen blocks, but keeps them searchable, selectable and
  in the accessibility tree, and always renders the block holding the selection
  or focus. `contain-intrinsic-block-size: auto 3rem` remembers each block's
  last drawn height, so the scrollbar settles as the writer moves through the
  document. `overflow-clip-margin` keeps table handles, which reach outside
  their block, visible.
  Measured: a keystroke on 1,200 blocks went from about 35,000 laid-out objects
  and about 37 ms to about 3,000 objects and about 11.5 ms.
- **Expensive node views start near the viewport.**
  - Code blocks are static highlighted `<pre>` until they come within half a
    screen or are reached for (`code-block/lazy-code-mirror.ts`).
  - Table handles place themselves only near the viewport
    (`document/measuring.ts`, `table/table-handles.ts`).
  - Planned: the same for diagrams, draw.io, embeds and link previews; images
    use `loading="lazy"` and `decoding="async"`.

If measurements at the upper tiers (section 9) ever show this is not enough,
the next step is **placeholder node views for whole off-screen sections**, not
general virtualisation. A section must be at least one heading's worth, must be
mounted before the selection or a search match enters it, and must keep its
heading in the DOM for navigation. The cost is exactly the list above, paid only
where proven necessary.

## 3. CSS that scales with what changed

Style recalculation is a hidden per-keystroke cost. A rule that relates siblings
(`* + *`, `h2 + *`, `~`) makes inserting one block restyle every block, and a
`:has()` over a long list does the same. That is why Enter cost 70–85 ms when
other keys cost about 11 ms.

- **Rule:** reading rhythm and editor spacing are properties of the element
  (margin-block-start with a `:first-child` reset, or custom properties an
  element sets for whatever follows), never of a pair.
- **Guard (in progress):** a stylesheet test that fails when a sibling
  combinator appears in the reading or editor stylesheets for spacing, with an
  allowlist that gives a reason for each exception.
- `:has()` is fine on small, bounded subtrees (a toolbar, a dialog) and never
  on the document or a list that grows with content.

## 4. Each edit costs what it changed

**In place:**

- **Plugins keep their state incrementally.** Decorations are mapped through the
  transaction (`DecorationSet.map`), and only the changed ranges are
  recomputed. Nothing walks the whole document on a keystroke. The keystroke
  guard counts document walks and fails CI if one appears.
- **Keyed widgets.** A widget decoration without a stable `key` is destroyed and
  rebuilt on every transaction, which forces layout. The unknown-label warning
  was one; it is now keyed.
- **One layout pass per frame for floating UI.** All position reads happen
  first, then all writes, in a shared frame (`document/measuring.ts`). Table
  handles, the table toolbar and the block inserter use it. Floating UI that is
  not visible does no layout work while the writer types, and the guard asserts
  zero layout reads per paragraph keystroke.

**Planned:**

- **Incremental serialisation for autosave.** This is the largest remaining
  main-thread cost (about 38 ms after a large paste). Nodes are immutable, so a
  `WeakMap<Node, string>` caches each top-level block's Markdown, and a save
  re-serialises only the blocks that are new. The join, and anything still
  heavy, moves to a worker.
- **Derived data stays incremental.**
  - The outline and table of contents, word counts, unknown labels and link
    checks are updated from the changed ranges.
  - Anything that cannot be computed incrementally waits for idle time or a
    worker. It is never computed per keystroke.

## 5. Off the main thread

Workers do the work that genuinely scales with document size. The protocol
sends only what changed (changed blocks as JSON, transferables for binary), so
copying between threads doesn't become the new bottleneck.

**In place:**

- **Streamed large pastes** (over 16 KB):
  - the Markdown is cut at block boundaries where every piece parses exactly
    as it does in the whole (`@quill/markdown/chunks`; proven by property tests
    over the corpus), and definitions are lent between pieces;
  - a pool of up to four module workers parses the pieces and converts them to
    editor JSON (`markdown-parser.ts`, `markdown-parse.worker.ts`), so the page
    only runs `Node.fromJSON`; named entities decode in the worker;
  - the page lands the blocks in slices that fit half a frame, learning what
    each kind of block costs (`time-slice.ts`), with a frame drawn between
    slices as often as drawing is cheap enough to afford;
  - one undo step removes the whole paste, and autosave hears one change
    (`large-paste.ts`).
- **Three-way merge** of documents over 400 blocks (`drafts/merge-runner.ts`,
  `merge.worker.ts`).

**Planned, in this order:**

1. Autosave serialisation (section 4).
2. **Streaming document open.** Parse and convert in the worker and insert the
   first screenful first, using the same machinery as paste. Today a large
   document's first paint waits for the whole conversion.
3. Compare/diff, find-and-replace across the document, word counts and link
   resolution.

**Fallbacks.** Every worker falls back to the page when workers are unavailable
or fail; jsdom tests run that path.

## 6. Input comes first: scheduling

**In place:**

- **The shared idle queue** (`document/idle-queue.ts`) runs visible work before
  background work and is cancellable.
- **Opening code blocks** happens in idle time, one task at a time.

**Planned:**

- **Priorities.** Background work runs through `scheduler.postTask` at
  `background` priority where supported, and yields every ~8 ms with
  `scheduler.yield()` (falling back to a `MessageChannel` macrotask), so a
  keypress is never queued behind more than one slice.
- **React stays out of the typing path.**
  - The document lives in ProseMirror, never in React state.
  - Panels around the editor (properties, outline rail, status, presence)
    subscribe to the narrow slice they show through `useSyncExternalStore`
    with selectors.
  - Their updates are non-urgent (`startTransition`, `useDeferredValue`), so a
    re-render of the rail can never delay a keystroke.
  - An audit of every subscriber to the editor state is part of this work.

## 7. The person always knows what is happening

From `docs/design/feedback.md`, applied to performance:

- **Under 100 ms:** no indicator. Anything that takes longer acknowledges the
  action where it is happening. A paste shows its placeholder at the paste
  point immediately, never a page-wide spinner.
- **Over 1 s:** progress ("Pasting 1,200 blocks…"), a visible Cancel, and Escape
  works.
- **Background work stays quiet but visible:**
  - saving, offline, and "merged your offline changes" are status, not
    interruptions;
  - work that matters to the page uses promise toasts.
- **Nothing ever locks the page.** A long operation keeps typing, scrolling and
  selection working. If it can't, it isn't allowed to be long: it is sliced or
  moved to a worker.
- **Failure is explicit and recoverable:** "Couldn't paste: try again", never a
  silent drop.

## 8. The application at large

**Routes and bundles**

- **Budget:** the reading route has 250 KB gzipped, guarded by
  `pnpm check:bundle` (`scripts/check-bundle.ts`).
- **Loaded on demand,** each guarded to stay its own chunk: the editor,
  overlays, deferred enhancements, search, share, move, delete, attachments,
  draw.io and compare.
- **Overlays** (menus, dialogs, tooltips, popovers) draw a light trigger
  permanently. The full component mounts only for the one instance being
  opened (`packages/ui/src/lib/on-demand.ts`, `useOnDemandWhen`). The trigger
  element is never replaced, so a fast click is never lost. Guarded: 1,000
  menus mount none until one is pressed.
- **Planned:** move editor-only stylesheets out of the global stylesheet,
  without breaking Tailwind's cascade order.

**Lists and trees**

- **The workspace tree is lazy end to end.**
  - The first response holds the top levels and the path to the current
    document.
  - Children load in pages of 50 when a branch opens.
  - The tree draws only expanded branches, and pages long branches with
    "Show more", so every row stays a real list item for screen readers and
    find.
  - Files: `GET /api/workspaces/:id/tree?depth&limit&focus`,
    `…/tree/children`, `apps/web/src/lib/api/navigation-tree.ts`,
    `packages/ui/src/components/tree.tsx`.
- **The workspace home pages its document lists.**
- **Rule:** any list that can grow with content is paged or windowed, and its
  data is paged at the API.
- **Planned:** database-level keyset paging for tree children, so a page
  doesn't load the workspace's rows on the server. A retry affordance for a
  failed page.

**Data and the network**

- **No N+1 queries.** List endpoints batch their relations, such as the owners
  lookup and child pages. Several tests assert the same number of calls for 3
  items and 43.
- **Compression.** JSON and text responses are brotli or gzip compressed
  (`apps/server/src/plugins/compression.ts`). Responses that set a cookie or are
  `no-store` are never compressed (BREACH).
- **Caching by content hash** for rendered bodies (ADR-031), and ETags with
  `304`s for public pages and comparisons.
- **The router preloads on intent** (hover or focus), and loaders seed the
  query cache so a navigation doesn't fetch twice.
- **Searching** stays inside its budget at 50,000 documents
  (`bench:search`).

**Reading surfaces**

- **The public site ships one small reader script** (ADR-023) with a gzipped
  budget, guarded by `packages/design-css/src/reader/bundle.test.ts`.
- **Enhancers do their work lazily or through observers:** highlighting through
  the CSS Custom Highlight API, the contents scroll-spy through an
  IntersectionObserver, animated images that pause off screen. Nothing runs
  scroll handlers.
- **Images** are served as AVIF or WebP in `<picture>` with intrinsic sizes
  (ADR-047), so nothing shifts as they arrive.

## 9. Proving it continuously

**Planned:** a performance suite in CI on a **production build**, Chrome with 4×
CPU throttling, against generated documents at three tiers: **1,000, 5,000 and
20,000 blocks**. Mixed content: headings, lists, tables, code, callouts, images.

**Each run measures:**

- opening, to the first screen and to fully interactive;
- keystrokes at the start, middle and end, in a table cell, and Enter;
- paste of 4,100 lines, and undoing it;
- scrolling (dropped frames over a fling);
- find-and-replace;
- saving.

**Rules:**

- Results are compared with the stored baseline. A regression beyond noise
  fails the build.
- Tier one must meet every budget. The higher tiers define the **supported
  size** and catch cliffs.

**Real use, measured anonymously.** The browser's Event Timing API (INP)
reported in aggregate, with no per-person tracking, catches what the suite
cannot.

## 10. Honest limits

- **Supported size:** the editor is designed to stay smooth up to a stated
  size, for now **10,000 blocks**, to be confirmed by the tier-two and
  tier-three runs.
- **Above it:** the editor says so once, quietly, and offers "Split at
  headings" (each top-level section becomes a child page, linked from a
  child-pages block). The editor never degrades silently.

## Checklist for a new feature

- [ ] **Cost per keystroke:** does it do work proportional to the document?
  Map, don't recompute; key every widget.
- [ ] **Layout reads:** does it read layout? Do it in the shared measuring
  frame, only while visible.
- [ ] **CSS:** does it add CSS that relates siblings or uses `:has()` over
  content?
- [ ] **Heavy work:** can it take more than 50 ms? Slice it or put it in a
  worker.
- [ ] **Feedback:** can a person wait for it? Show something where it happens
  within 100 ms; past 1 s show progress and allow cancel.
- [ ] **Loading:** is it needed for the first paint of a reading page? If not,
  load it on demand and add it to the bundle guard.
- [ ] **Lists:** does it list things that grow? Page the API, page or window
  the list.
- [ ] **Proof:** is it measured? Add or extend a budget guard, and check it
  against the production-build run.
