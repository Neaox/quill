# @quill/editor

The writing surface (ADR-003) and the client half of drafts and locking (ADR-021). It makes no requests: everything it needs from outside is an interface the web application implements, which is why the whole package is testable with fakes.

## What goes in

- **`<DocumentEditor ast={…} />`** takes an mdast root and gives one back through `toMdast()` on its ref or on the `onChange` handle. The AST is what a draft stores; editor JSON is never persisted. The AST is initial content, so replacing the document from outside means remounting with a new `key`.
- **`onComment(request)`** — the block menu reports a range; anchoring a comment is the application's (ADR-022).
- **`onRequest({ kind: 'image' })`** — the slash menu asks for an address rather than inserting a broken image. Uploads arrive later through an `AttachmentClient` the application owns; to the editor they are a URL like any other.
- **`slashItems`** replaces the built-in insert catalogue; `placeholder`, `label`, `editable`, `softBreaks` and `className` are plain props.
- **`useDocumentLock({ client })`** takes a `LockClient` (`acquire`, `heartbeat`, `release`, `takeover`) and runs ADR-021's 15-second heartbeat, its escalation after one and two missed beats, and its refusal to resume without a successful heartbeat.
- **`useAutosave({ client, store, canSave })`** takes a `DraftClient` (`load`, `save(ast, expectedVersion)`) whose results mirror the ADR's contract exactly — `saved`, `stale_version`, `lock_lost`, `session_expired` — and a `RecoveryStore` that keeps the unsent draft until it is acknowledged. `createMemoryRecoveryStore()` ships here; IndexedDB is the application's.
- **`Clock`** is injected everywhere time matters, so tests never wait.
- **`useTemplateProgress(ast)`** returns the checklist ADR-029's template panel shows. The panel itself is the application's.

## What comes out

The schema is the Markdown package's, extended here with the HTML ProseMirror needs, table roles, node views, keymaps, and menus — never with a node of its own, so a document opened and saved unchanged serialises to the byte the Markdown package would have written. `src/document/ast.test.ts` proves that over the whole fidelity corpus.

## Styling

Components compose `@quill/ui` primitives and express state as attributes styled by Tailwind variants (`docs/architecture/styling.md`). The editor renders semantic classes — `layout-content`, `code-block`, `directive-guidance`, `required-section-marker` — laid out by the design system on the reading grid of ADR-027. The writing surface carries `prose` on the grid itself, exactly as the reading surface does, so a block takes the same width, the same measure, and the same vertical rhythm while it is written as when it is read; `packages/ui/src/styles/editor.css` covers only what a class list cannot reach, chiefly the DOM CodeMirror builds inside a code block.
