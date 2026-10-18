# ADR-051: Find and replace in the editor

**Status:** Accepted
**Date:** 2026-10-12 (revised 2026-10-17: incremental search, off-screen blocks, the menus)
**Related:** ADR-002 (Markdown is canonical), ADR-038 (emoji: decorations over text), ADR-040 (tables), quill-plan.md section 31 (the keystroke budget), `AGENTS.md` rules 12, 13 and 14

## Context

The editor had the browser's find and nothing else. The browser's find cannot see text inside a collapsed `details`, cannot replace, and has no regular expressions. Writers coming from VS Code expect the find widget they know: a query with match case, whole word and regular expression toggles, "3 of 12", Enter and Shift+Enter to step, a replace row, replace all, find in selection, preserve case on replace, and capture groups in a replacement.

Multiple cursors were asked about and left out: ProseMirror has one selection, a custom multi-range selection touches typing, deleting, pasting and undo, and find and replace gets most of the value for prose.

## Decision

**It is the current document only.** Workspace-wide search is the search feature (ADR-010); replacing across documents is not offered.

**The state is a ProseMirror plugin's, not React's.** `find-plugin.ts` holds the query, replacement, options, the stretch searched when finding in a selection, what was found and which match the selection is on. It is found again as the document changes, the stretch moves with the edits, and the bar is a view of it (`useEditorState`) whose buttons run commands (`find-commands.ts`). Nothing about find is kept in two places. `reduceFind` is a pure function of state, action and document. Find searches the ProseMirror document, never the DOM, so text in a block the browser has not drawn (below) or in a collapsed `details` is found like any other.

**A keystroke costs nothing with the bar closed, and one block with it open** (quill-plan.md section 31). Closed, the plugin's `apply` returns the state it was given and its decorations are the empty set. Open, an edit is not searched from scratch: a match never leaves its line and every line is inside one top-level block, so `find-refresh.ts` maps the matches outside the blocks the transaction touched (`document/changed-blocks.ts`, which the label and emoji decorations use too) and searches only the touched blocks again; the highlights are mapped and redrawn only there. Replacing one match goes through the same path. The exception is a search that stopped at its limit, where what lay past the limit was never looked for: that is searched again from the start, lazily to the limit. `keystroke-budget.test.tsx` holds a 4,100-line document to zero whole-document walks per keystroke with the bar open on a common word, as it does with the bar closed.

**What is searched is a line of text at a time.** `block-text.ts` joins a textblock's pieces into one string and says where each character is, so a word that is half bold is found whole. A match never runs from one block into the next, never across the edge of an inline element such as a badge (replacing it would take the element's tokens), and never takes in an image (a replacement would delete it). Code blocks are not searched: they are drawn by their own editor, which highlights cannot reach, and a match that cannot be seen is worse than none. Inline code is searched. A search stops at 10,000 matches and says "10,000+"; replace all does not stop.

**The query follows VS Code's.** Plain text is matched literally. A regular expression is compiled in Unicode mode, case-insensitively unless asked, and an invalid one is reported with the engine's reason rather than failing. Whole word bounds a query with Unicode-aware lookarounds, and applies to a regular expression as it does in VS Code. A match that is empty is skipped: there is nothing to select or replace. A replacement is literal for plain text; for a regular expression `$1`, `$&`, `$$` and `$<name>` are read, and preserve case follows the match (all capitals, all lower case, a capital first).

**A replacement is one transaction and keeps its marks.** Replace all goes from the last match to the first so each keeps its place, and is one step of undo. Replacing one goes on to the next match in the same transaction (`appendTransaction`). The inserted text takes the marks of the text it replaces.

**The keys are VS Code's, with one Mac accommodation.** Ctrl+F opens find, seeded with a selection on one line; Ctrl+H opens it with the replace row (Ctrl+Alt+F too, since Command+H hides a Mac window); F3 and Ctrl+G step, with Shift back; Escape closes it only while it is open. In the bar: Enter, Shift+Enter, Alt+C, Alt+W, Alt+R, Alt+P, Alt+L, and Ctrl+Alt+Enter, by the key's place so a Mac's Option does not change the letter. The opening keys work from inside the bar too, which holds the focus. The document's keys are named once in `format/shortcuts.ts` (`SHORTCUTS.find`, `replace`, `findNext` and the rest), which the extension binds and every menu and the shortcuts dialog read.

**Find is in the menus as well as on the keyboard.** The context menu has a find contribution (`find/find-menu.ts`, in the registry beside the others): "Find and replace…" anywhere in the document, and, with words selected, "Find in document" first. The selection toolbar has a "Find in document" button. Each shows its shortcut, and opens the bar with the selected words as the query, exactly as Ctrl+F and Ctrl+H do. Words across two lines cannot be looked for, so there the entry and the button stay where they are, disabled with that reason (`docs/design/feedback.md`).

**Select next occurrence (Ctrl+D)** uses the same matching (`document/select-next-occurrence.ts`): the word at the caret first, then each next place the selected words come, as whole words, round to the start. It moves one selection on; it is not multiple cursors.

**Searching in a selection follows the writer's selection.** The stretch is taken when the option is switched on, and a new selection made in the editor becomes the stretch; a click, which selects nothing, ends it, so no tint is left behind that looks like a selection that is gone. Find's own moves to a match (`step`) are marked so they are not mistaken for the writer's.

**The selection and the current match stay in view while the keyboard is in the bar.** A browser stops painting the selection of an editor that has lost focus, so the plugin draws it as a decoration (`selection-held`), draws the stretch searched when finding in a selection, and outlines the current match; the styles are in `packages/ui/src/styles/editor.css`, the editor's own stylesheet. ProseMirror scrolls a selection into view only when its own DOM selection is the browser's, which is not so with the caret in the bar, so stepping brings the match to the middle of the page itself (`reveal.ts`), but only when it is behind the bar or off the page, so a match already in view does not make the document jump.

**A match in a block the browser has skipped is reached in two steps.** Top-level blocks off screen are `content-visibility: auto`: each stands at a remembered or guessed height, so where a position inside one is drawn is not known until it is drawn, and centring on `coordsAtPos` alone can land a screen away. `reveal.ts` therefore scrolls the match's top-level block into view first, which has the browser draw it and its neighbours at their real heights, and in the next animation frame measures the match again and centres it if it is still not in view.

**The bar hangs below the application's header**, at `--sticky-chrome-top` plus a margin, so scrolling never slides it under the fixed bar. It is a labelled `search` landmark; the toggles are buttons with `aria-pressed`; the count is a polite status; an invalid expression sets `aria-invalid` and is described by the status.

## Alternatives considered

- **Find state in React.** A document edit would then have to tell React to search again, and the stretch for "find in selection" would drift from the text. The plugin gets both for free.
- **Multi-line matches.** `\n` across blocks would need a model of blocks as lines; VS Code's multi-line search has no equivalent in a tree of blocks. Not offered.
- **Searching code blocks.** Replacement works on the document, but highlights and selection would have to be pushed into CodeMirror. Left until code blocks expose their search.
- **A replace-all that reads the match again.** Re-running the pattern on the matched text loses lookbehind and anchors; each match keeps what the engine captured.

## Consequences

- Writers get the find they already know, and replace, in every document.
- A keystroke while the bar is open and a query is set searches the block it changed, not the document; the bar closed costs nothing. Changing the query or an option, opening the bar and replace all still search the whole document, bounded by the 10,000-match limit except for replace all. A search past the limit is redone from the start on each edit, which is bounded by the limit but is the one case where a keystroke walks more than its block.
- A catastrophic regular expression can stall the page. This is VS Code's trade-off in a browser, without a worker; moving the search into one is the remedy if it is met.
- Code blocks are not searched until they can show a match.
