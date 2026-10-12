# ADR-041: Code blocks: copy and groups

**Status:** Accepted
**Date:** 2026-10-11
**Related:** ADR-002 (Markdown is canonical), ADR-011 (security baseline), ADR-023 (public publishing), ADR-030 (syntax highlighting), ADR-031 (render caching), ADR-033 (compatibility), ADR-039 (Markdown extensions)

## Context

Code is first-class content for Quill's first users, and two things every documentation platform readers know already offers were missing:

- **A copy button.** Readers select code by dragging, and pick up the line numbers or the prompt glyph with it, or miss a line.
- **Tabbed code.** The same request in TypeScript, Python and curl, or the same install in npm, pnpm and yarn, is written today as three blocks one after another, and the reader scrolls past the two they do not want.

Both have to work on every surface: the signed-in reader, presentation mode, the public site and the editor. Documents also arrive from other platforms, and each of those writes tabbed code its own way.

### What other platforms write

| Platform | Syntax | Markdown? | Linked choice | Per-block title |
| --- | --- | --- | --- | --- |
| VitePress | `::: code-group` wrapping fences titled ```` ```ts [Label] ```` | Container extension | No | The `[Label]` |
| Fumadocs | Consecutive fences with `tab="Label"` in the meta, no wrapper | Yes, plain fences | `<Tabs groupId>` only | `title="file.ts"` |
| Material for MkDocs | `=== "Label"` followed by indented content | Indentation-sensitive extension | Yes, by label, site-wide | `title="file.ts"` |
| GitBook | `{% tabs %}{% tab title="Label" %}…{% endtab %}{% endtabs %}` | Template tags | No | No |
| Docusaurus | `<Tabs groupId>` and `<TabItem value label>` | MDX | `groupId` | `title="file.ts"` |
| Starlight | `<Tabs syncKey>` and `<TabItem label>` | MDX | `syncKey` | Expressive Code `title` |
| Mintlify | `<CodeGroup>` around fences whose meta is the tab name | MDX | No | The meta |

## Decision

### Copy

Every code block on every surface carries one small icon button in its top corner. It is shown on hover and focus, and always on a touch screen. Its accessible name is "Copy code", or "Copy TypeScript code" when the language is known. It copies the block's exact text, never a line-number gutter or a prompt glyph. If the reader has selected text wholly inside the block, it copies only that, and its name, its label and its icon change to "Copy selection". The page watches `selectionchange`, debounced to the frame, and asks only where the selection's common ancestor is.

When the copy succeeds, a check mark and "Copied" are shown and announced through one polite live region, and the button returns after 1.5 seconds. When the clipboard is refused, the text that would have been copied is selected, and the button says "Press Ctrl+C to copy" (⌘C on a Mac).

The button is created by script, so a page that runs none has no dead button. A single shared module builds it, `@quill/design-css/copy`. The reader's enhancer (`@quill/design-css/code-blocks`) uses it for every block, including a block in a callout, a list, a table cell, a card, or a diagram slot whose source is showing. The editor's code-block view uses it too, and there it reads CodeMirror's selection.

### Code groups: what Quill reads, imports and writes

**Read live, and written back in the form the author used, byte for byte:**

- VitePress `:::code-group` (a container directive, ADR-002) and `::: code-group` (with the space, as VitePress's own documentation writes it). The members are fences titled ```` ```ts [Label] ````.
- Fumadocs runs of consecutive fences carrying `tab="Label"`.

**Imported, never read live:** Material for MkDocs `===` tabs, GitBook `{% tabs %}`, and the MDX components (Docusaurus and Starlight `<Tabs>`/`<TabItem>`, Mintlify `<CodeGroup>`). `packages/markdown/src/import/code-groups.ts` holds pure converters into the canonical form, each with fixtures from its platform, ready for the M4 importer. Only tabs whose every panel is exactly one fence are converted, because that is what a code group is; tabs of prose are left as written. MkDocs is import-only because CommonMark reads its syntax as a paragraph and an indented code block. Making it live would change how core syntax parses, which ADR-039 forbids. The others are template tags or JSX, which are not Markdown.

**Written, for a group made in the editor:** VitePress's `:::code-group` with ```` ```lang [Label] ````. Fumadocs' form degrades a little better, because on GitHub its fences are plain code blocks with nothing left over, where VitePress leaves two `:::` lines. It was still not chosen:

- Its group has no boundary. Two groups written one after the other read as one group.
- It has nowhere to put the group's own attributes, such as `sync`.
- It is not Quill's own directive syntax, which every other container uses (ADR-002, ADR-036).

A label left empty falls back to the tab's title, then to its language's name ("TypeScript"), then to its fence tag, then to "Code 2".

The spaced VitePress form is not a directive. It is recognised in the parsed tree: a paragraph that is exactly `::: code-group`, the fences after it, and a paragraph of colons. Recognising it this way changes how nothing else parses. One module, `packages/markdown/src/code-group/`, owns parse, serialise, render, the sanitiser grant and the editor node, in the shape a `MarkdownExtension` takes (ADR-039), so the construct can move behind that contract unchanged. Each group keeps its syntax, its blank-line spacing and its opening line. A container directive around a group counts the group's colons, so a callout holding one is written back with enough colons to stay closed in the right place.

### Rendering

The server draws what a reader without script should see. That is every panel, stacked, each a `figure.code-block` captioned with its tab's name, inside a `div.code-group`. Every other block is in a card (`div.code-block`). A block whose meta names a file (`title="src/app.ts"`, as Docusaurus, Fumadocs and Expressive Code write it) is a `figure` captioned with the file. This applies to a single block and to a tab of a group.

The enhancer then turns each group into a WAI-ARIA tablist. Arrow keys, Home and End move between tabs, with a roving tab stop, `aria-controls`, and a `role="tabpanel"` wrapper around each panel; a captioned figure may not take the role itself. The tabs sit in a compact strip across the top of the card. The chosen tab is marked by weight, colour and an accent underline. The width the bold label needs is kept for it, so choosing never shifts the strip. Labels do not wrap, and a strip with many tabs scrolls sideways with no visible scrollbar. The group's one copy button sits in the strip and copies the panel on show.

### Linked choice

Picking "Python" in one group picks it in every group on the page that has a "Python" tab. Groups are linked by label by default, as MkDocs' linked tabs and Docusaurus' `groupId` link them. An optional `:::code-group{sync=pkg-manager}` names a different key, mirroring `groupId` and `syncKey`, and groups only follow choices made under their own key. The group being clicked stays still on screen while the others change height around it. Each key's last choice is remembered per reader in `localStorage`, under `code-group-choices`, and every read and write is wrapped so that a refused or full store costs only the memory.

### Security

The sanitiser grant (`CODE_SANITIZE_GRANT`) admits:

- the classes `code-block`, `code-group`, `code-caption`, `code-label` and `code-title`, each on the element that carries it;
- `data-sync`, only in a sync key's own shape (`^[A-Za-z0-9][\w-]{0,31}$`).

A key in any other shape is dropped before rendering. An author's own HTML imitating a group is escaped to text, as all raw HTML is. Tests in `code-group/render.test.ts` hold this in place.

### The editor

A group is a `codeGroup` node of code blocks. Its view shows the tabs across the top and the tab on show beneath. Each tab is an ordinary code block, with a language field that searches the reader's languages and the same copy button a reader gets. In the view:

- Tabs are added with a button. They are renamed in place by double-click or F2, removed with a cross or Delete, and reordered by dragging or with Alt and an arrow key.
- Every change is one transaction and one undo step.
- Choosing a tab changes nothing in the document, so the caret never jumps.
- Escape or an arrow key at the edge of a tab leaves the group, rather than going to a hidden tab.
- A group can be inserted from the slash menu and the block inserter ("Code group").

`RENDER_VERSION` is 7.

## Alternatives considered

- **Server-rendered tabs with CSS only (radio inputs).** These work without script, but they hide panels from a reader who cannot use them, need form controls in the sanitiser, and cannot link choices across a page.
- **MkDocs `===` read live.** It changes how indented code parses (ADR-039), so it is imported instead.
- **A per-language "preferred language" setting.** Choices made in context and remembered by key cover the need, and a settings page is not needed.

## Consequences

- Documents written for VitePress and Fumadocs show tabs in Quill without being rewritten, and still read as code blocks everywhere else.
- Every code block in an existing body changes shape (a card wrapper), so `RENDER_VERSION` moves to 7 and bodies render again on next read (ADR-031).
- The public reader script grows by about 3.3 KiB gzipped. Its budget is now 12 KiB, shared by four enhancers.
