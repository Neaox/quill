# The editor against Confluence: an audit, the reliability findings, and a roadmap

<!-- cspell:words CONFCLOUD keymap indexeddb undos lockstay refetched refetches -->

**Question.** How does Quill's document editor compare with Confluence Cloud's editor? Confluence is the bar to reach or beat. Notion, Linear docs and GitBook are secondary references. Where is Quill broken, where does it fall short, and where can it do better?

**Method.** The audit was done on 2026-10-11 and had three parts.

1. **Desk research.** We read Atlassian's own documentation, jira.atlassian.com CONFCLOUD issues (with their vote counts), and Atlassian Community threads. A Reddit search returned nothing usable, so community sentiment comes from Atlassian Community and comparison sites. The Notion, Linear and GitBook comparisons come from product knowledge and are marked as unverified where it matters.
2. **Hands-on testing.** We used the built-in browser against the dev servers (`web` on :5173, `server` on :3000) at 1440 × 900 and at 375 × 812. All testing was on a new scratch document, *Editor audit scratch*, in Engineering → Architecture. Nothing else was edited or deleted.
3. **Reliability probes.** We ran probes in the page and a read-only round-trip script over the corpus (`packages/markdown/corpus`, 23 files) plus the 189 Markdown files in the lockstay `docs/`, 212 documents in all.

No product code was changed.

**Context for the numbers.**

- **Concurrent work.** Other sessions were editing the server, tables, code groups and emoji during the audit. `tsx watch` therefore restarted the API every 30 to 90 seconds, and the API was stopped and restarted twice through the preview tools. That is a harsher network than production, but it is exactly the network a laptop on hotel wifi gives an author. Several findings below were reproduced *because* of it, and each is backed by a code path.
- **Build.** Timings were taken in the Vite dev build, so they show orders of magnitude and ratios, not release figures.
- **Work in flight.** Uncommitted work on block autoformat (`packages/editor/src/document/autoformat.ts`), table options (`:::table`, ADR-040), code groups and emoji was present but not yet live in the editor when it was tested. The matrix records what a user gets today and notes the in-flight work.

Screenshots are in [`assets/2026-10-11-editor-audit/`](assets/2026-10-11-editor-audit/).

---

## Summary

**The foundation is right; the safety net has holes.**

What works:

- The Markdown converter is excellent. After the first save, a one-word edit changes exactly one line in all 212 real documents, and every document is idempotent.
- Pasting Markdown works well: headings, nested lists, GFM tables, fences, tasks and directives all arrive as structure.
- Undo across structural edits restores the document exactly.
- The two-tab conflict is *detected*.

**Five reliability defects are P0**, because each one can lose an author's work or lie about it:

1. **A failed draft save leaves autosave stuck on "saving" forever.** One 502 or one network error during a `PUT /draft` does it. Nothing is retried, and later edits are never sent. This was reproduced live.
2. **A background refetch error tears the editing session down.** Any transient 5xx on the document, draft or envelope query replaces the open editor with "Couldn't open this document for editing" and unmounts it. Unsaved edits go with it. This happened six times in one hour of testing.
3. **The IndexedDB recovery buffer is closed on mount under React StrictMode,** so in development it never records anything. After a teardown the unsent edits were gone and the recovery notice never appeared. Production is probably unaffected, but the hook pattern is fragile, and the guarantee the end-to-end tests appear to cover is not exercised in dev.
4. **The heartbeat retries with zero delay.** During a 40-second API restart one tab sent 296 heartbeat requests.
5. **"Reload the draft" does not reload anything.** It clears the stale-version stop, and the next keystroke then silently overwrites the other tab's saved edit. The "two tabs are safe" promise of ADR-021 fails after one click.

**The biggest P1 gaps against Confluence:**

- No Markdown autoformat. `## `, `- `, `**bold**` and `` `code` `` all stay literal. Block autoformat is in flight; inline rules are not.
- The slash menu inserts nothing basic. There are no headings, lists, quote or divider, and `/head` finds nothing.
- No selection toolbar and no link UI. Ctrl+K opens global search instead of a link dialog.
- No table controls. Inserting a table also leaves the caret outside it.
- Task items have no checkboxes in the editor.
- Callouts have no tone in the editor.
- The block menu sits at the top of the document instead of beside the block.
- Typing costs about 90 to 120 ms per keystroke on a 4,000-line page. The whole document is converted to mdast on every keystroke.

**Where we can clearly exceed Confluence:**

- Confluence's most-voted editor requests are Markdown editing (CONFCLOUD-68272, 531 votes) and full Markdown support (CONFCLOUD-68137, 241). Quill is Markdown by construction, and a source mode plus "paste Markdown that just works" turns that into a visible advantage.
- Confluence's orphaned and auto-resolved inline comments are a known pain. ADR-022's visible orphans can beat that.
- So can honest version compare, and a performance budget Confluence publicly misses.

---

## 1. Feature matrix

Legend: **✓** works, **◐** partial or rough, **✗** missing. "Proposed" is what the roadmap in section 4 delivers. The P-labels refer to it.

### 1.1 Inserting and structuring

| Capability | Confluence Cloud | Quill today | Proposed |
| --- | --- | --- | --- |
| `/` quick insert | ✓ Everything, with type-ahead, plus the `@ : ! [ {` triggers | ◐ Only table, code block, image, seven callouts, three widths and four template blocks. No headings, lists, quote, divider, task list, link, emoji, mention or date. No icons and no shortcut hints. `/head` gives "No matching block" (`04-slash-no-heading.jpg`) | Full catalogue grouped as Basic / Media / Structure / Template, with icons and the autoformat hint per item (P1-2). The in-flight `AUTOFORMAT_HINTS` already plans the hints |
| Markdown autoformat while typing | ◐ `#`, `*`, `1.`, `>`, ```` ``` ````, `---`, `[] `, `**b**`, `*i*`, `` `c` ``, `~~s~~`, `[t](url)`. `- ` is unverified | ✗ None (`01-no-markdown-autoformat.jpg`). Block rules are in flight in `autoformat.ts`; there are no inline mark rules | Block rules plus inline mark rules, all undoable with Backspace (P1-1) |
| Keyboard shortcuts | ✓ A large set, with Ctrl+/ help | ◐ Bold, italic, strike, code, H1–H6 (Mod-Alt-n), lists, code block, undo and redo. Mod-k, underline and Ctrl+/ help are missing | Mod-k link, Ctrl+/ shortcut sheet, Mod-Shift-↑/↓ to move a block (P1-4, P1-9) |
| Drag handles and block moves | ✓ A per-block handle with Turn into, Move, Copy link, Copy and Delete. Layout columns are draggable | ◐ One "⋮ options" button pinned above the document's first line, not beside the block (`06-block-menu-detached-from-block.jpg`). Move up/down, duplicate, delete and width work, with no drag, no "turn into" and no "copy link to block". "Add comment" is disabled because the route does not wire `onComment` | Hover and caret-following gutter handle with drag (the drop cursor is already installed), Turn into, Copy link to heading, and keyboard moves (P1-5) |
| Panels and callouts | ✓ Five types plus custom colour and emoji | ◐ Seven types insert and round-trip, but the editor draws every callout as the same plain bordered box, with no tone, icon or title (`09-…jpg`) | The editor draws callouts as the reader does, with a type switcher in the block menu (P1-7) |
| Expand / details | ✓ Including nesting | ✗ | `:::details{summary="…"}`, which degrades to the summary as bold text followed by the body (P2-6) |
| Layouts and columns | ✓ Up to five columns | ◐ Widths (content, wide, full) only, which Confluence lacks per block. No columns | `:::columns` with child `:::column`, which degrades to sequential sections (P2-6) |
| Task lists | ✓ `[] ` action items with assignees and dates | ◐ Insert by paste, and the round trip is correct, but the editor shows **bullets with no checkbox**: no state, no toggle | Checkbox node view, toggled by click and Mod-Enter (P1-6) |
| Mentions, dates, status | ✓ `@`, `/date`, `/status` | ◐ Badges and tenant labels (`:ok[Built]`, ADR-037) exist as text directives. No mentions or dates | `:date[2026-10-11]`, `:user[@id]{name}` and `:status[In review]{tone}`, each degrading to its label text (P2-5) |
| Emoji | ✓ `:` picker | ◐ Shortcodes are drawn (ADR-038). A picker is in flight | Picker on `:` (in flight) |

### 1.2 Formatting and selection

| Capability | Confluence Cloud | Quill today | Proposed |
| --- | --- | --- | --- |
| Selection (bubble) toolbar | ◐ Fixed top toolbar plus contextual toolbars | ✗ No toolbar of any kind. Selecting text shows nothing | A selection bubble with bold, italic, code, strike, link, comment and "turn into", keyboard-reachable with Alt+F10 (P1-3) |
| Links | ✓ Ctrl+K, Smart Links (inline, card, embed) and paste conversion | ◐ Pasting a URL over a selection makes a link, and that is all. No way to edit or remove a link, see its address or open it. **Ctrl+K opens global search** | Link popover (edit, open, unlink, copy) on Mod-k and on caret-in-link. Paste a URL on an empty line → choose Link / Card (P1-4, P2-4) |
| Find and replace | ✓ Ctrl+F in the editor; no regex or space-wide replace | ✗ Browser find only. It works because nothing is virtualised, but there is no replace | In-editor find and replace with case, whole-word and regex, as decorations (P1-10) |
| Code blocks | ✓ Language, line numbers, copy and wrap (CONFCLOUD-31476, 139 votes, fixed 2024) | ✓ CodeMirror with language, syntax colour, line numbers and copy. Code groups are in flight | Wrap toggle, title, highlighted lines via fence meta, which degrades to the plain fence (P2-7) |

### 1.3 Tables

| Capability | Confluence Cloud | Quill today | Proposed |
| --- | --- | --- | --- |
| Insert | ✓ | ◐ `/table` inserts a 2 × 3 table, but **the caret stays outside it**: typed text lands in the next block (`07-table-insert-caret-left-outside.jpg`). Empty cells draw as zero-height rows | Caret into the first header cell, and minimum cell height (P1-8) |
| Add and remove rows and columns | ✓ Hover "+" controls, a context menu, and Ctrl+Alt+arrows | ✗ The commands exist (`tableCommands`) but nothing exposes them. Tab in the last cell does not add a row | Table toolbar and cell menu, and Tab in the last cell adds a row (P1-8) |
| Resize, sticky header, freeze columns, sort | ◐ Resize yes. Sticky header only in view mode. No freeze columns (CONFCLOUD-39480). Sort is per viewer and not saved | ✗ in the editor. `:::table{columns=… freeze=… sort=…}` (ADR-040) is in flight for the reader | Editor UI for the `:::table` options. Widths are stored as `columns="2fr 3fr"`, which degrades to a plain GFM table (P2-2) |
| Merge cells, cell colour | ✓ | ✗ | **Not built.** GFM cannot represent them, and ADR-002 says "stored beside the document or not built". Recommend not building; offer `:::table{responsive=stack}` and header-column emphasis instead |
| Narrow screen | ◐ | ✗ Columns squeeze and break words mid-word ("REGIO / N"). ADR-027 says tables scroll horizontally (`08-mobile-375-table-words-broken.jpg`) | `overflow-x: auto` wrapper and `min-width: max-content` columns in the editor, as in the reader (P1-11) |

### 1.4 Images and media

| Capability | Confluence Cloud | Quill today | Proposed |
| --- | --- | --- | --- |
| Insert and upload | ✓ Drag, paste, picker | ✓ Dialog by address or file, drag and drop, and paste a file. Alt text is asked for, which is better than Confluence. Several dropped files are dropped after the first | Accept several files in one pass (P2) |
| Resize, align, caption, border | ✓ (captions were CONFCLOUD-2584, 265 votes) | ◐ Width through `:::wide` / `:::full`. Captions through `:::figure`, which renders in the reader but has no editor affordance. No resize handles | Image toolbar with width presets (content, wide, full) and "Add caption", which wraps in `:::figure`. A free pixel width is not proposed: Markdown has no portable width (P1-12) |
| Smart link cards and embeds | ✓ | ✗ | Card and embed directives with a live block (ADR-032) and server-side fetch through the SSRF-safe client. They degrade to a plain link (P2-4) |

### 1.5 Paste fidelity

| Source | Confluence Cloud | Quill today | Proposed |
| --- | --- | --- | --- |
| Markdown (plain text) | ◐ Often stays raw or becomes code (Community, 2021 and 2024) | ✓ **Excellent.** Headings, nested lists, tables, fences, quotes, tasks and directives all convert | Keep, and advertise it |
| Google Docs | ◐ | ✗ **Everything becomes bold**, because Docs wraps the clipboard in `<b style="font-weight:normal" id="docs-internal-guid-…">` and the `b` parse rule accepts it. The `h2` became a bold paragraph | A paste transformer that ignores `font-weight:normal|400` on `b` and maps Docs' heading and list structure (P1-13) |
| Word | ◐ (CONFCLOUD-4337) | ✗ Bullets arrive as paragraphs beginning "·  " (`mso-list` is not understood). Bold survives | Word list normaliser (`mso-list` → `ul`/`ol` levels) and removal of Office `o:p` and `<![if]>` noise (P1-13) |
| Excel and Sheets | ◐ (CONFCLOUD-7118, 21 votes, open since 2006) | ◐ The HTML table arrives as a table with no header row. The TSV-only path (Sheets sometimes) arrives as text | First row becomes the header; plain TSV becomes a table (P1-13) |
| Rich paste nested in a callout or list | n/a | ◐ A multi-block paste at the end of a callout flattens into that callout's list item | Paste at the end of a container splits out to top level when the slice opens at block level (P2) |

### 1.6 Saving, history and collaboration

| Capability | Confluence Cloud | Quill today | Proposed |
| --- | --- | --- | --- |
| Autosave | ✓ Continuous to a shared draft. Complaints: spurious "unpublished changes" (CONFCLOUD-56893) and silent draft loading (CONFCLOUD-84847) | ◐ The debounced loop and statuses are good, **but see P0-1, P0-2 and P0-3**. On a phone the status badge is hidden (`hidden sm:block`), so a phone author never sees "saving" or "lock lost" | Fix the P0s. Show a compact status dot at every width. Never mark "unsaved" for caret moves (we already don't) |
| Locking and two tabs | n/a (real-time co-editing) | ◐ Another user is blocked correctly. **The same user in two tabs: both "hold" the lock**. The stale write is detected, but "Reload" does not reload (P0-5) | "Open in another tab" detection through BroadcastChannel; a reload that really reloads (P0-5) |
| Real-time co-editing and presence | ✓ | ✗ By design for release 1 (ADR-021). Presence shows the lock holder only | Yjs on the draft row later (ADR-021). Not proposed here |
| Inline comments | ✓, but comments are auto-resolved or deleted when their anchor text changes | ✗ in the editor ("Add comment" is disabled). ADR-022 is designed | Decorations and visible orphans per ADR-022 (P2-1) |
| Version history and compare | ✓ but worse lately ("too similar to display", colour diff removed: CONFCLOUD-83966) | ✓ In the reading view: revision panel, compare and restore. Formatting-only changes are labelled | Compare from inside the editor ("what changed since publish") (P2-3) |
| Undo and redo | ◐ Lost-work threads | ✓ Thirty undos after move, duplicate, width, typing and table insert restored the document byte-for-byte as JSON. ◐ One redo sequence dropped the final typing (see 2.6) | Add an undo/redo regression test over structural sequences (P1-14) |
| Source / Markdown mode | ✗ (CONFCLOUD-68272, 531 votes; CONFCLOUD-68137, 241) | ✗ Planned in section 17 ("CodeMirror … a raw Markdown mode") | **Source mode toggle** that edits the same draft through the converter (P2-0: our biggest differentiator) |

### 1.7 Long pages, accessibility, mobile

| Capability | Confluence Cloud | Quill today | Proposed |
| --- | --- | --- | --- |
| Long pages | ◐ CONFCLOUD-70197 (84 votes, High). p99 input latency was 274 ms in 2020 and 80 ms in 2021 | ✗ About 85 to 120 ms per keystroke at about 4,100 Markdown lines (1,226 blocks), against the plan's 16 ms budget. About 16 ms without the per-keystroke conversion | Convert lazily at save time; incremental decorations (P0-6 / P1-15) |
| Accessibility | ◐ (a UW–Madison review in Dec 2025 found unreachable areas) | ◐ Good bones: the editor is `role=textbox` with a label, the slash menu is a real listbox driven from the caret, and the block menu is a menu with radio items. Gaps: no keyboard route to the block menu from inside the text (it is a separate tab stop above the document), no shortcut sheet, and tone or state carried by nothing (callouts and tasks) | Mod-Alt-/ opens the block menu at the caret; F10 / Alt+F10 reaches the toolbar; tasks and callouts get accessible names (P1-5, P1-6, P1-7) |
| Mobile editing | ◐ The apps cannot edit macros or table structure | ◐ Editing works at 375 px, but the workspace tree is expanded above the document and takes the first half-screen, the save status is hidden, tables break words, and the block trigger is a 23 × 32 target at the screen's left edge | Collapse the tree on phones, keep the status dot, scroll tables, and add a bottom formatting bar on touch (P1-11, P2-8) |

---

## 2. Reliability findings, with reproduction steps

### 2.1 P0-1: one failed save freezes autosave on "saving"

**Seen.** After a `PUT /api/documents/:id/draft` answered **502** during a server restart, the badge read "saving" for over 60 seconds. Typing more did not send another request: the network log shows no further PUT. See `02-autosave-stuck-saving-after-502.jpg`.

**Cause.** In `packages/editor/src/drafts/use-autosave.ts`, `save()` sets `savingRef.current = true` and then `await client.save(...)`, with no `try`/`finally`.

- `useDraftClient.save` (in `apps/web/src/lib/api/editor-clients.ts`) rethrows anything that is not 423, 409 or 401. A 5xx and a network `TypeError` both throw.
- `savingRef` therefore stays `true` and the status stays `'saving'`.
- Every later `change()` skips `setStatus('pending')`, because `savingRef.current` is true. The debounce effect only runs from `'pending'`, so nothing is ever retried.
- The rejection is unhandled, because the effect calls `void save()`.

**Reproduction.**

1. Open any document in the editor.
2. Stop the `server` preview, or block `PUT */draft` in devtools.
3. Type a character and wait two seconds.
4. Restart the server and keep typing. The badge never leaves "saving", and nothing reaches the server until a reload.

**Fix.**
- Wrap the call in `try`/`finally`, and add a `'retrying'` status with exponential backoff (1 s, 2 s, 4 s … capped at 30 s, with jitter).
- Resume on `online` and on `visibilitychange`.
- Show "offline: saved in this browser" rather than "saving".
- Add a unit test with a client whose `save` rejects.

**Files:** `packages/editor/src/drafts/use-autosave.ts`, `use-autosave.test.ts`, `apps/web/src/features/documents/editor-status.tsx`.

### 2.2 P0-2: a background refetch error unmounts the editor

**Seen.** This happened six times. While an author was editing, a refetch of the document, draft or envelope query hit a 502, and `EditorRoute` replaced the whole session with "Couldn't open this document for editing / Request failed with status 502" (`03-editor-torn-down-by-background-refetch.jpg`). In-flight text was lost: a 4,000-line paste that had not yet been saved disappeared.

**Cause.**
- `EditorRoute` renders the error notice whenever `document.isError || draft.isError`.
- In TanStack Query v5 a *refetch* failure sets `isError` even though `data` is still present.
- `query-client.ts` retries only non-`ApiError` failures (`retry: (n, e) => !(e instanceof ApiError) && n < 2`). A 502 or 503 is an `ApiError`, so it fails immediately.
- During editing, all queries refetched every few seconds: `/api/me`, the workspace tree, the theme, the draft and the envelope each appeared twice in a 10-second sample. Each refetch is a chance to tear down.

**Reproduction.**
1. Open the editor.
2. Restart the API (or return 502 from the dev proxy for one second).
3. Focus the window to trigger a refetch.

**Fix.**
- Once the session is open, gate the error branch on `data === undefined`, not on `isError`.
- Retry 502, 503 and 504 (and 429 with `Retry-After`) with backoff in `query-client.ts`.
- Disable `refetchOnWindowFocus` for the draft query while editing: the editor owns that state, and a refetched draft must never replace it anyway.
- Add a component test: refetch rejects with 502, and the editor stays mounted.

**Files:** `apps/web/src/features/documents/editor-route.tsx`, `apps/web/src/lib/api/query-client.ts`, `apps/web/src/lib/api/drafts.ts`.

### 2.3 P0-3: the IndexedDB recovery buffer never writes under StrictMode

**Seen.** After a teardown with pending edits, the `quill-recovery` → `pending-drafts` store was **empty**, and the reloaded editor showed no "Recovered an unsent edit" notice.

**Cause.** `useRecoveryStore` (`apps/web/src/lib/recovery/use-recovery-store.ts`) creates the store in `useMemo` and calls `store.close()` in the effect's cleanup.

- React 19 StrictMode (`apps/web/src/main.tsx`) runs mount, cleanup, mount. The first cleanup closes the memoised store, and the second mount reuses the same closed instance.
- `enqueue` then returns early on `closed`, so every `write` stays in memory only.
- A production build does not double-invoke effects, so production is probably unaffected. But:
  - every developer and every dev-server end-to-end run is testing a recovery path that is switched off;
  - any future remount of the hook (an `<Activity>` boundary, or a route-level `key`) would switch it off in production too.

**Reproduction.**
1. In dev, open the editor.
2. Block `PUT */draft`.
3. Type.
4. In devtools, run `indexedDB.open('quill-recovery')` → `pending-drafts` → `getAllKeys()`. The result is `[]`.

**Fix.** Create and close the store inside the same effect (state holds the instance), or make `close()` idempotent and re-openable. Add a StrictMode test that asserts `write` reaches IndexedDB.

**Files:** `apps/web/src/lib/recovery/use-recovery-store.ts`, `indexeddb-recovery-store.ts`, and their tests.

### 2.4 P0-4: the heartbeat retries in a tight loop

**Seen.** One tab sent 296 `POST /lock/heartbeat` requests during a roughly 40-second outage.

**Cause.** `HEARTBEAT_RETRY_DELAY_MS = 0` in `use-document-lock.ts`. A failed heartbeat reschedules at 0 ms for as long as the state stays `reconnecting` or `at_risk`, which it does while the server is down.

**Why it matters.** With 100 editors open, a 30-second deploy turns into a self-inflicted flood exactly when the server comes back.

**Fix.** Keep the immediate first retry from R5 section 4, then back off (1 s, 2 s, 4 s, capped at 10 s, so a 60-second lock expiry still gets several attempts). Pause while `navigator.onLine === false`. Add a fake-clock test that counts requests over a 60-second partition.

**Files:** `packages/editor/src/drafts/use-document-lock.ts`, `use-document-lock.test.ts`.

### 2.5 P0-5: two tabs, one user, a silent overwrite

**Seen (step by step).**
1. Tab A and tab B open the same document for the same user. Both show "editing", because the same session re-acquires the lock.
2. A types "TAB1" and saves (draft version 11).
3. B types "TAB2". B gets `409 stale_version` and shows "This draft changed somewhere else … Reload the draft". This part is correct.
4. B clicks **Reload the draft**. Its content does not change (still "TAB2"), and the warning stays.
5. B types one more character and saves **successfully** at version 12. The server draft now holds "TAB2 … more". **A's "TAB1" edit is gone from the draft**, and tab A still says "draft saved".

**Cause.**
- `onReloadDraft` refetches the draft query.
- `EditingSession` is keyed only by `documentId`, and `DocumentEditor` reads its AST once. The refetched content is never shown.
- The new `draftVersion` prop raises the autosave's version, so B's next write carries a current version and wins.

**Reproduction.** As above. An `<iframe>` of the edit URL serves as the second tab.

**Fix.**
- "Reload the draft" must remount the editor with the server draft: key the session by `draftVersion` on an explicit reload.
- Offer *Keep mine* (which then writes with the new version knowingly), with the unsent AST kept in recovery.
- Detect a second tab with a `BroadcastChannel('quill-doc-<id>')` handshake, and make the later tab read-only with "Editing in another tab — switch here".

**Files:** `apps/web/src/features/documents/editor-route.tsx`, `packages/editor/src/drafts/use-autosave.ts`, and a new `packages/editor/src/drafts/tab-presence.ts`.

### 2.6 Undo and redo across structural edits

**Probe.** The edits were made through the UI:
1. Block menu: Move down, Duplicate, Wide.
2. Type.
3. Enter, then `/table` and Enter.
4. Type "c1", Tab, type "c2".

**Results.**
- **Undo:** 30 × Ctrl+Z restored the document **exactly**, compared as JSON.
- **Redo:** 30 × Ctrl+Shift+Z restored everything **except the last "c1c2" typing**.
- A simple type, undo, redo cycle works with both Ctrl+Shift+Z and Ctrl+Y.

The redo loss is most likely an `appendTransaction` plugin (emoji, required markers, placeholder typing) that dispatches an undoable transaction after the undo and so truncates the redo stack. It was not isolated here.

**Proposed:** an editor test that replays this exact sequence and asserts the redo round trip (P1-14).

This probe also surfaced two UX bugs:
- After Duplicate, the duplicated block's text was *selected*, so the next keystrokes replaced it.
- After `/table`, the caret stayed in the block after the table, so "c1c2" landed in a heading (`07-…jpg`).

### 2.7 Pasting rich HTML

The probes used synthetic `ClipboardEvent`s carrying real-world clipboard HTML.

| Payload | Result |
| --- | --- |
| Markdown as plain text (headings, nested list, table, fence, quote, tasks, `:::callout`) | ✓ All converted to structure |
| Google Docs HTML | ✗ Everything bold; the heading lost |
| Word HTML (`MsoListParagraph`, `mso-list`) | ✗ Bullets become paragraphs starting "·  " |
| Excel HTML table | ◐ Arrives as a table with no header row; the first row is not promoted |

### 2.8 A very long document

The document was 4,081 Markdown lines: 240 repeated sections, each with a heading, a paragraph with marks and a link, a nested list, a table and a TypeScript fence. That gives 1,226 top-level blocks, 240 CodeMirror instances and about 18,500 DOM nodes. All figures are from the dev build.

| Measure | Result |
| --- | --- |
| Paste of the whole document | 1.5 s |
| Re-render of the whole document (replace content) | 74 ms |
| One keystroke (dispatch of a one-character insert), as wired by the editor route | p50 85 to 120 ms, p90 126 to 153 ms, worst 1.9 to 2.8 s |
| The same keystroke with the route's `onUpdate` listener removed | p50 about 16 ms |
| `state.apply` alone (all plugins) | 0.4 ms |

**Cause.** `DocumentEditor`'s `onUpdate` fires on every doc-changing transaction. The route's `onChange` calls `handle.toMdast()`, a full ProseMirror → mdast conversion of the whole document, and then `autosave.change()`. That writes the whole AST to the recovery store and sets React state, on every keystroke. The work is O(document) per character.

The plan (section 31) budgets 16 ms. Confluence's own public figure was 80 ms p99 in 2021 (CONFCLOUD-70197).

**Fix.**
- Mark the draft dirty on update, and convert to mdast only when the debounce fires, on `flush()`, and on `pagehide`.
- Buffer to IndexedDB on the same cadence, every second at most, rather than per keystroke.

This is P0-6, because it is what makes long runbooks unusable. Size **M**.

**Files:** `apps/web/src/features/documents/editor-route.tsx`, `packages/editor/src/drafts/use-autosave.ts` (accept a thunk `() => DocumentAst`), `packages/editor/src/document/document-editor.tsx`.

The 240 eagerly mounted CodeMirror views are the next cost. Mounting them lazily (render a static highlighted `<pre>` until the block is focused or scrolled into view) is P1-15.

### 2.9 Round trip: edit, save, view source

**Probe.** A read-only script ran `parseDocument → mdastToProseMirror → liftLayout → wrapLayout → proseMirrorToMdast → serializeDocument` over 212 real documents: the corpus plus the lockstay `docs/`. Error count: zero.

| Check | Result |
| --- | --- |
| Byte-identical on first open, with `softBreaks: 'preserve'` | 72 / 212 (34%) |
| Byte-identical on first open, with the editor's default `softBreaks: 'collapse'` | **6 / 212 (3%)** |
| Idempotent (a second pass is unchanged) | 212 / 212 ✓ |
| A one-word edit after normalisation changes exactly one line | 212 / 212 ✓ |

**Verdict.** Untouched parts are byte-stable *after* the first save. The first save, though, rewrites almost every hand-written file. ADR-002 licenses one formatting-only normalisation and the diff labels it, but some of the rewrites are worse than formatting:

- **GitHub alerts are broken.** `> [!IMPORTANT]` becomes `> \[!IMPORTANT]`. Quill still renders the escaped form as an alert, but GitHub, GitLab and Obsidian then render a plain quote. The seeded *The sync map* already carries `\[!IMPORTANT]`. The lockstay docs use alerts, and the project memory requires that they render unchanged. **P0-7, size S:** let `[!TYPE]` through unescaped in `to-markdown-extensions.ts` when it is the first text of a blockquote.
- **`~` becomes `\~` everywhere.** 120 escapes were added, for example "\~3.5%". This is correct under GFM single-tilde strikethrough, but it is diff noise and reads badly in Git. Escape only a run that would actually pair (P1).
- **Every table's delimiter row** is rewritten from `|---|---|` or `| --- |` to `| - | - |`. Alignment colons are kept. Preserve the source delimiter width where it is unchanged, or accept and document this (P2).
- **Directive attributes** are quoted (`{type=warning}` becomes `{type="warning"}`). This is harmless but noisy (P2).
- **Hard breaks** written as two trailing spaces become `\`. **List continuation lines** are re-indented from two spaces to four. Both are accepted normalisations; document them in the diff label.
- **Soft wraps collapse on first save** (`collapse` is the default). This is the documented ADR-002 one-time change, and it is the reason only 3% of documents are byte-identical. The diff view must say so plainly.

The probe script is `scratchpad/roundtrip-probe.ts` in this session's scratch space. **Recommended:** turn it into `packages/markdown/src/prosemirror/real-docs.test.ts`, gated on a `QUILL_REAL_DOCS` path, so each of these is a named, counted regression.

---

## 3. Confluence complaints we can beat, and how

| # | Confluence complaint (evidence) | How Quill beats it |
| --- | --- | --- |
| 1 | **No Markdown editing or source view.** CONFCLOUD-68272 (531 votes), CONFCLOUD-68137 (241), CONFCLOUD-38904 (24). Pasted Markdown stays raw | Markdown is the file. Ship (a) a **source mode** toggle (CodeMirror over the same draft, which ADR-003 already names), (b) Markdown autoformat on input, and (c) the paste conversion that already works. Say so in the product |
| 2 | **Slow editing on long pages.** CONFCLOUD-70197 (84 votes, High), 72519, 64686. Advice is to split pages | Keep the 16 ms budget honest: lazy conversion (P0-6), lazy CodeMirror (P1-15), and a long-page benchmark next to the tests (plan section 31) |
| 3 | **Lost content and draft confusion.** CONFCLOUD-79494, 80783, 56893, 84847 | One explicit model: the draft autosaves, publish creates a revision, and the status always tells the truth. Fixing P0-1 to P0-5 is the precondition. Confluence's "unpublished changes" on a caret move is something we already avoid |
| 4 | **Inline comments vanish or auto-resolve when the anchor text changes**, or are hidden after migration | ADR-022: selectors outside the Markdown, re-anchoring, and **orphans that stay visible** with their original quote. Never resolve silently |
| 5 | **Version compare got worse** ("too similar to display", CONFCLOUD-83966; colour diff gone) | The reading view already has compare and restore with formatting-only labelling. Add "changes since publish" inside the editor, and keep a colour-blind-safe diff with +/- markers (P2-3) |
| 6 | **Smart Links auto-convert with no off switch** | Paste a URL and get a link; the card is opt-in through the link popover, and the choice is remembered per author (P2-4) |
| 7 | **Fixed-width pages waste the screen**; templates cannot be full width (CONFCLOUD-71432, 70000) | Already ahead: per-block widths (ADR-027) and `layout:` in front matter, which templates can set |
| 8 | **Table regressions**: widths do not stick, no frozen columns, sort not persisted (CONFCLOUD-39480, 56145, 65284) | `:::table{columns freeze sort}` (ADR-040) stores the choices in the document, readable in a diff. Give it an editor UI (P2-2) |
| 9 | **Poor paste from Word and Excel** (CONFCLOUD-7118, open since 2006; CONFCLOUD-4337) | Docs, Word and Excel normalisers with fixture tests built from real clipboards (P1-13) |
| 10 | **Features lost between editors** (captions, borders, indent, code wrap) | ADR-033 compatibility and ADR-039 "both surfaces, always": no syntax exists on one surface only. Keep the source island as the guaranteed fallback |
| 11 | **Mobile apps cannot edit macros or table structure** | One responsive web editor, with the same block menu and table controls on touch (P1-11, P2-8) |

---

## 4. Prioritised roadmap

Sizes: **S** is up to a day, **M** is two to four days, **L** is a week or more. Every item lands with its test first (AGENTS.md rule 1). Items that touch rendering or paste run `docs/security/checklist.md`.

### P0: broken or unreliable

| ID | Item | Size | Files |
| --- | --- | --- | --- |
| P0-1 | Autosave survives a thrown save: `try`/`finally`, a `retrying` status with backoff, resume on `online` and `visibilitychange`, and an honest offline badge | S | `packages/editor/src/drafts/use-autosave.ts`, `use-autosave.test.ts`, `apps/web/src/features/documents/editor-status.tsx` |
| P0-2 | A transient error never unmounts an open editor: gate on missing data, retry 502/503/504 with backoff, no focus refetch of the draft while editing | S | `apps/web/src/features/documents/editor-route.tsx`, `apps/web/src/lib/api/query-client.ts`, `apps/web/src/lib/api/drafts.ts`, `editor-route.test.tsx` |
| P0-3 | The recovery store is created and closed in the same effect (StrictMode-safe), with a test that writes reach IndexedDB | S | `apps/web/src/lib/recovery/use-recovery-store.ts`, `indexeddb-recovery-store.ts` (and tests) |
| P0-4 | Heartbeat backoff after the first immediate retry, paused while offline, with a fake-clock request-count test | S | `packages/editor/src/drafts/use-document-lock.ts`, `lock-machine.ts`, tests |
| P0-5 | Two tabs: a reload that remounts with the server draft, a deliberate *Keep mine*, and a BroadcastChannel second-tab guard | M | `apps/web/src/features/documents/editor-route.tsx`, `packages/editor/src/drafts/use-autosave.ts`, new `packages/editor/src/drafts/tab-presence.ts` |
| P0-6 | Convert to mdast lazily (on debounce, flush and `pagehide`), not per keystroke. Add a long-page latency benchmark | M | `packages/editor/src/document/document-editor.tsx`, `packages/editor/src/drafts/use-autosave.ts`, `apps/web/src/features/documents/editor-route.tsx`, new `packages/editor/src/document/long-document.bench.ts` |
| P0-7 | Do not escape GitHub alert markers (`> [!NOTE]` and the rest) on save; corpus test with the lockstay alert documents | S | `packages/markdown/src/pipeline/to-markdown-extensions.ts`, `packages/markdown/corpus/` (new alert fixture), `corpus.test.ts` |

### P1: gaps that make us feel below Confluence

| ID | Item | Size | Files | Markdown and degradation |
| --- | --- | --- | --- | --- |
| P1-1 | Autoformat. Block rules are in flight. Add inline mark rules for `**b**`, `*i*`/`_i_`, `` `c` ``, `~~s~~` and `[t](url)`, all undoable with Backspace | M | `packages/editor/src/document/autoformat.ts`, `extensions.ts` | Pure CommonMark/GFM |
| P1-2 | Slash catalogue: text, H1–H3, bullet, numbered, task, quote, divider, link, emoji, plus the existing items; groups, icons, shortcut hints, and fuzzy match that includes "h2" and "todo" | S | `packages/editor/src/slash/slash-items.ts`, `slash-menu.tsx` | Core Markdown |
| P1-3 | Selection bubble toolbar (marks, link, comment, turn into), reachable with Alt+F10 and labelled | M | new `packages/editor/src/menu/selection-toolbar.tsx`, `document-editor.tsx` | n/a |
| P1-4 | Link popover: Mod-k to insert or edit, open, unlink, copy; caret in a link shows the address. Move global search off Mod-k inside the editor, or yield to it | M | new `packages/editor/src/document/link-popover.tsx`, `keymap.ts`, the command palette binding in `apps/web` | Inline links, plus reference links preserved |
| P1-5 | Block handle beside the block (hover and caret), drag to move with the existing drop cursor, Turn into, Copy link to heading, Mod-Shift-↑/↓, and a shortcut to open the menu at the caret | L | `packages/editor/src/block/block-menu.tsx`, `block/commands.ts`, `block/block-state.ts`, `keymap.ts` | n/a |
| P1-6 | Task item node view with a real checkbox, toggled by click and Mod-Enter, announced with its state | S | `packages/editor/src/schema/dom.ts` (or a new `task-item-view.ts`) | `- [ ]` and `- [x]` |
| P1-7 | Callouts drawn with tone, icon and title as the reader draws them; type switcher in the block menu | S | `packages/editor/src/template/directive-view.ts`, `block/block-menu.tsx` | `:::callout{type}`, which degrades to the body text |
| P1-8 | Tables: caret into the first cell on insert, minimum cell height, row and column toolbar, a cell context menu, Tab at the end adds a row, Mod-Alt-arrows | M | `packages/editor/src/schema/tables.ts`, `slash/slash-items.ts`, new `packages/editor/src/schema/table-toolbar.tsx`, `keymap.ts` | GFM tables. Multi-block cells are still prevented (ADR-003) |
| P1-9 | Shortcut sheet (Ctrl+/), generated from the keymap so it can never drift | S | `packages/editor/src/document/keymap.ts`, new `shortcut-sheet.tsx` | n/a |
| P1-10 | Find and replace in the editor (case, whole word, regex) as decorations | M | new `packages/editor/src/document/find-replace.ts` and a panel | n/a |
| P1-11 | Phone editing: tables scroll horizontally in the editor; the tree collapses; a compact save-status dot at every width; a larger block trigger | S | the editor table CSS in `packages/ui`, `apps/web/src/features/documents/editor-status.tsx`, the workspace shell | n/a |
| P1-12 | Image toolbar: width presets (content, wide, full) and *Add caption* (wraps in `:::figure`), alt-text edit | M | new `packages/editor/src/document/image-toolbar.tsx`, `block/commands.ts` | `![alt](src)`, `:::wide` and `:::figure` all degrade to a plain image followed by its caption paragraph. No pixel widths, which have no portable Markdown |
| P1-13 | Paste normalisers for Google Docs (`b[font-weight:normal]`, heading styles), Word (`mso-list` levels, `o:p` noise) and Excel/Sheets (header-row promotion, TSV to table), with fixtures from real clipboards | M | `packages/editor/src/document/paste.ts`, new `paste-normalise.ts`, fixtures | Lands as plain CommonMark/GFM. Colours and fonts are dropped by design |
| P1-14 | An undo/redo regression suite over structural sequences, and a fix for the plugin that truncates redo | S | `packages/editor/src/edge-cases.test.tsx`, `packages/editor/src/template/*`, `document/emoji.ts` | n/a |
| P1-15 | Lazy CodeMirror: a static highlighted `<pre>` until the block is focused or near the viewport | M | `packages/editor/src/code-block/code-block-view.ts` | n/a |
| P1-16 | Reduce first-save churn: do not escape `~` unless it pairs, and keep the source table delimiter width | M | `packages/markdown/src/pipeline/to-markdown-extensions.ts`, `pipeline/options.ts`, and a real-documents test | The serialiser remains canonical and idempotent |
| P1-17 | A new document opens in the editor, not the reading view's "Start writing" notice | S | the document creation flow in `apps/web/src/features/documents/*`, `features/workspaces/*` | n/a |

### P2: where we would exceed Confluence

| ID | Item | Size | Files | Markdown and degradation |
| --- | --- | --- | --- | --- |
| P2-0 | **Source mode.** Toggle between the rich editor and a CodeMirror Markdown view of the same draft. Switching converts through mdast. Unknown syntax is shown verbatim | L | new `packages/editor/src/source/source-editor.tsx`, `document-editor.tsx`, `editor-route.tsx` | It *is* the Markdown |
| P2-1 | Inline comments per ADR-022: decorations, a side rail, re-anchoring, visible orphans, never silently resolved | L | `packages/editor/src/comments/*` (new), the server comments module, `block-menu.tsx` (`onComment`) | Stored beside the document in Postgres (ADR-002). Not in the Markdown |
| P2-2 | Editor UI for `:::table` (ADR-040): drag column widths into `columns="…"`, freeze header and first column, default sort, stack on phones | M | `packages/editor/src/schema/tables.ts`, the table toolbar from P1-8 | Degrades to a plain GFM table |
| P2-3 | "Changes since publish" panel inside the editor, with a formatting-only label and a colour-blind-safe diff | M | `apps/web/src/features/documents/revision-diff-view.tsx`, `editor-route.tsx` | n/a |
| P2-4 | Opt-in link cards and embeds through a live block (ADR-032), fetched server-side through the SSRF-safe client | L | `packages/markdown/src/directives/` (new `card` or `embed`), `packages/editor/src/document/link-popover.tsx` | `::card{href}` degrades to a link |
| P2-5 | Dates, mentions and status as text directives with pickers (`:date[…]`, `:user[…]{id}`, `:status[…]{tone}`) | M | `packages/markdown/src/directives/`, editor bindings per ADR-039 | Each degrades to its bracketed label text |
| P2-6 | Expand and columns: `:::details{summary}` and `:::columns` / `:::column`, with editor views | M | `packages/markdown/src/directives/`, `packages/editor/src/template/directive-view.ts` | Details degrade to a bold summary followed by the body; columns degrade to sequential sections |
| P2-7 | Code block extras: wrap toggle, title, highlighted lines through fence meta (`ts title="x" {3-5}`) | S | `packages/editor/src/code-block/code-block-view.ts`, `packages/markdown` fence meta | Fence info string; other renderers ignore the meta |
| P2-8 | Touch formatting bar above the on-screen keyboard (marks, list, indent, insert) | M | new `packages/editor/src/menu/touch-toolbar.tsx` | n/a |
| P2-9 | Real-time co-editing (Yjs on the draft row, ADR-021 consequence) | L | `packages/editor/src/drafts/*`, server drafts | Unchanged: drafts still hold the AST |

### Suggested order

1. P0-1 to P0-4 together (one PR, all small).
2. P0-7.
3. P0-6.
4. P0-5.
5. P1-1, P1-2, P1-6 and P1-7: quick, visible wins that make the editor feel like a modern editor.
6. P1-4 and P1-3.
7. P1-8 and P1-11.
8. P1-5.
9. The rest of P1.
10. P2-0 (source mode) as the headline feature that Confluence's two most-voted requests ask for.

---

## Appendix A: what Confluence offers, in brief (sources)

- **Shortcuts and autoformat.** Atlassian's "Keyboard shortcuts" page (`support.atlassian.com/confluence-cloud/docs/find-keyboard-shortcuts`) lists Ctrl+Alt+0..6 for headings, Ctrl+Shift+7/8/9 for lists and quote, Ctrl+Shift+M for inline code, Ctrl+K for links and Ctrl+F for find and replace. Autoformat covers `#`, `*`, `1.`, `>`, fences, `---`, `[] `, `<> `, `**`, `*`, `` ` `` and `~~`.
- **Markdown requests.** CONFCLOUD-68272 (531 votes, Reviewing), CONFCLOUD-68137 (241 votes, Gathering Interest), CONFCLOUD-38904 (24).
- **Performance.** CONFCLOUD-70197 (84 votes, High; p99 input latency 274 ms → 80 ms reported in 2021), CONFCLOUD-72519, CONFCLOUD-64686, CONFCLOUD-72430 (2 MB view limit).
- **Tables.** CONFCLOUD-39480 (freeze columns), CONFCLOUD-56145 (sticky header in edit), CONFCLOUD-65284 and 65665 (widths), CONFCLOUD-66366 (nested tables).
- **Paste.** CONFCLOUD-7118 (Excel, 21 votes, since 2006) and CONFCLOUD-4337 (Word).
- **Images.** CONFCLOUD-2584 (captions, 265 votes, shipped 2021), CONFCLOUD-67895 (borders), CONFCLOUD-67122 (annotations).
- **Code.** CONFCLOUD-31476 (wrap, 139 votes, fixed Sept 2024) and CONFCLOUD-66437 (fewer options than the old macro).
- **Drafts.** CONFCLOUD-56893, 79494, 80783, 84847.
- **History.** CONFCLOUD-83966 ("too similar to display"), CONFCLOUD-73219.
- **Comments.** Atlassian's KB "Keep inline comments while editing" documents that deleting anchor text resolves the comment.
- **Legacy editor retirement.** New legacy pages were blocked from January 2026, with full retirement around April 2026 (Atlassian developer community announcement).
- **Accessibility.** The UW–Madison evaluation of December 2025 (`kb.wisc.edu/accessibility/page.php?id=127137`) found keyboard-unreachable areas and problems at 200–300% zoom.

## Appendix B: screenshots

| File | What it shows |
| --- | --- |
| `01-no-markdown-autoformat.jpg` | `## `, `- `, `**bold**`, `> `, `1. `, `---` and ```` ``` ```` all stay literal |
| `02-autosave-stuck-saving-after-502.jpg` | "SAVING" for over a minute after one 502; later edits never sent |
| `03-editor-torn-down-by-background-refetch.jpg` | An open editing session replaced by "Couldn't open this document for editing / 502" |
| `04-slash-no-heading.jpg` | `/head` gives "No matching block" |
| `05-slash-menu.jpg` | The slash menu: no basic blocks, no icons, no hints |
| `06-block-menu-detached-from-block.jpg` | The block menu opens from a "⋮" above the document, not beside the block |
| `07-table-insert-caret-left-outside.jpg` | `/table` inserts an empty, nearly invisible table; typed text lands in the next heading |
| `08-mobile-375-table-words-broken.jpg` | At 375 px the table breaks words mid-word; the tree takes the top half of the screen |
| `09-mobile-375-tasks-no-checkboxes-callout-no-tone.jpg` | Task items as bullets with no checkboxes; a callout with no tone |
| `10-editor-1440-rendering.jpg` | What is good: the editing surface matches the reader (labels, badges, the wide diagram) |
