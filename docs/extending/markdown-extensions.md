# Extending Quill's Markdown

Quill documents are Markdown, and Quill's Markdown can be extended. This guide covers what an extension is, the three ways to add one, and what each must provide. The decision behind it is [ADR-039](../architecture/decisions/0039-markdown-extensions.md).

> **Status, 11 October 2026.** The contract below is decided. The registry, the conformance kit and the declarative settings ship in stages (ADR-039, "Delivery"). Labels (ADR-037) and emoji (ADR-038) are the first declarative extensions. Until the packaged tier lands, a new feature is added to `packages/markdown` directly, in the same shape. The `MarkdownExtension` type and its registry exist for the first claim an extension can make, a drawing (`@quill/markdown/extension`), and draw.io is built on them as the reference extension: copy its shape (below).

## The one rule: both surfaces

Every extension works where documents are **read** (the app, the public site, presentation mode, export) and where they are **written** (the editor). An extension that has no way to be shown, edited and written back in the editor cannot be installed. There is no reading-only plugin.

Every extension also **degrades**. A document that uses it must still read sensibly as plain Markdown: on GitHub, in a Git diff, or in a Quill instance that does not have the extension installed. Directives give you this for free, which is why they are the default.

## Choose a tier

| You want to… | Use | Who can install it |
| --- | --- | --- |
| Give your organisation a named label, an emoji, or a custom directive drawn as one of Quill's built-in blocks | **Declarative** | An organisation administrator, in Settings |
| Add syntax with its own rendering and editor behaviour | **Packaged** | The operator of a self-hosted instance |
| Reuse an existing remark or rehype plugin | **Adapted** | The operator of a self-hosted instance |
| Show data that changes: a status, a query, a branch's file | **Packaged, with a live binding** | The operator of a self-hosted instance |

Tenants never upload code. Most needs fit the declarative tier, so start there.

## Declarative extensions

These are data, not code, so they are safe on a shared instance.

- **Labels:** `:acme[Acme]` draws a pill with a dot in the label's colour, and the same name colours a diagram's shapes. Define them in **Settings → Theme → Labels**.
- **Emoji:** `:acme:` draws your organisation's image, and `:+1:` draws 👍 (every GitHub shortcode works without setup). Upload custom ones in **Settings → Theme → Emoji**; they are stored in the organisation's settings rather than in the theme, so they survive a change of theme. A label leads with the emoji of its own name, or the one chosen for it under Labels (ADR-038).
- **Custom directives** (planned): name a directive, choose its kind (`:inline`, `::leaf`, `:::container`), list its attributes, and pick how it is drawn from Quill's own renderings: badge, callout, card, figure or details. For example, `:::decision{status=accepted}` drawn as a callout titled with its status.

Quill renders, sanitises and edits these with its own code, so they are on both surfaces automatically and can never widen what a page may contain.

## Packaged extensions

A packaged extension is an npm package that default-exports one `MarkdownExtension`:

```ts
import { defineExtension } from '@quill/markdown/extension'

export default defineExtension({
  id: 'acme.decision',
  version: '1.0.0',

  // What it claims. Prefer a directive: it degrades by itself.
  syntax: { directive: { name: 'decision', kind: 'container', attributes: DecisionAttributes } },

  // mdast -> model, reporting problems instead of throwing.
  parse: (node) => ({ status: node.attributes?.status ?? 'proposed', body: node.children }),

  // model -> mdast: how the editor writes it back. Must round trip byte for byte.
  serialize: (model) => decisionNode(model),

  // model -> hast: one template, used by the app, the public site and export alike.
  render: (model, h) => h('aside', { className: ['decision'], dataStatus: model.status }, h.children(model.body)),

  // Exactly what the output needs from the sanitiser. Values are enumerations or patterns, never "any".
  sanitize: {
    aside: { className: ['decision'], dataStatus: ['proposed', 'accepted', 'superseded'] },
  },

  // The writing surface: a declared view, input rules, a toolbar entry.
  editor: { view: 'container', title: (model) => `Decision: ${model.status}`, insert: { label: 'Decision', icon: 'gavel' } },

  // Optional CSS under `.prose`, using theme tokens only.
  styles: `.prose .decision { border-inline-start: 3px solid var(--color-accent); }`,
})
```

Install it by listing it in the instance configuration and rebuilding:

```yaml
markdown:
  extensions:
    - '@acme/quill-decision'
```

### The editor binding

Pick the simplest binding that works:

1. **A declared view.** You fill one of the editor's own node shapes (inline pill, block card, container, figure). You get selection, undo, collaboration and accessibility for free.
2. **A custom node view.** A ProseMirror node view of your own, for behaviour no declared view has. It is loaded lazily, only in documents that use it.
3. **The source island.** The editor shows the rendered result, and clicking it edits the Markdown source in place. It always works and never loses anything, and it is what adapted plugins use.

### The insert entry: slash menu items

The binding's `insert` entry becomes one or more items in the editor's slash menu. Until the packaged tier lands, a feature in this repository contributes them directly, through the slash registry in `@quill/editor` (`packages/editor/src/slash`). This is the stable way to add to the menu; never edit the menu itself.

A contribution is an object with an `id` and an `items(environment)` function. `environment` is what the application knows when the editor is built: the organisation's `labels`, its `customEmoji`, and `searchDocuments`. Return no items when something you need is missing.

```ts
import { CodeIcon } from '@quill/ui'
import { commandItem, insertBlock, type SlashContribution } from '@quill/editor'

export const codeGroupItems: SlashContribution = {
  id: 'quill.code-group',
  items: () => [
    commandItem(
      {
        id: 'code-group',              // unique and stable: recently used items are remembered by it
        label: 'Code group',
        description: 'Several code blocks as tabs',
        group: 'Code',                 // one of SLASH_GROUPS, or a new group shown after Quill's
        keywords: ['tabs', 'snippets'],
        aliases: ['tabs'],             // an exact alias ranks the item first
        icon: CodeIcon,                // from @quill/ui; add a glyph there, with its test, if none fits
        shortcut: undefined,           // the Markdown autoformat, if there is one, shown as a key
      },
      insertBlock((schema) => schema.nodes.codeGroup.create(/* … */)),
    ),
  ],
}
```

Register it by adding it to `BUILT_IN_SLASH_CONTRIBUTIONS` in `slash-registry.ts` (Quill's own features), or pass it to `DocumentEditor`'s `slashContributions` prop. The registry refuses two items with one id.

What every item must do:

- **Act in one transaction.** `run({ state, dispatch })` is handed the state after the typed `/query` is removed. Dispatch once. The removal and your change are one undo step, which gives the query back. `commandItem(meta, command)` builds an item from a ProseMirror command.
- **Say where it fits.** `available(place)` hides the item where it cannot go. `commandItem` answers it by dry-running the command. Items that are not `inline: true` are never offered in a table cell, because a GFM cell holds one line of inline content.
- **Put the caret where the author expects.** Use `insertBlock` (it replaces the empty line the slash was typed on, or goes after the line) and `insertInline` (it selects the text inside the new node) from `slash-commands.ts`. An empty paragraph made by `paragraph(schema)` is marked synthetic, so a container left empty is written as `:::name` with nothing inside it.
- **Ask, never guess.** An item that needs input uses `pickerItem(meta, picker, available)`. The picker is a `list` source (filtered as the author types) or a `search` source (debounced and abortable). Cancelling it inserts nothing. An item that needs the application, such as an upload, calls `request(...)` with a `SlashRequest`.
- **Round-trip.** Add the item to `slash-catalogue.test.ts`, which checks the Markdown it writes, where the caret lands, and that the Markdown survives the editor unchanged.

### The context menu: entries for what is under the pointer

The writing surface has its own context menu, opened by a right-click, by Shift+F10 or the context-menu key at the caret, and by a long press on a touch screen, where it is a sheet along the bottom of the screen. What it offers depends on what is under the pointer: words, a link, a table cell, a picture, a code block, a callout, and always the block as a whole. It is assembled from contributions through the context menu registry in `@quill/editor` (`packages/editor/src/context-menu`), the same shape as the slash menu's. Quill's own parts each live with the feature that owns them (`format/text-menu.ts`, `link/link-menu.ts`, `table/table-context-menu.ts`, `image/image-context-menu.ts`, `code-block/code-block-menu.ts`, `callout/callout-menu.ts`, `block/block-context-menu.ts`). Never add an entry by editing another feature's part or the menu itself.

A contribution has an `id`, an `order` (lower comes first), an optional section `label`, and `entries(place)`. `place` is the editor view and state, the document position the menu acts on, and the `environment`: what the application lets the menu do, such as `openLink`, `linkTo`, `copyText`, `clipboard` and `requestImage`. Return no entries where your feature has nothing to say about the place.

```ts
import type { ContextMenuContribution } from '@quill/editor'

export const footnoteMenu: ContextMenuContribution = {
  id: 'quill.footnote',
  order: 45,
  label: 'Footnote',
  entries: ({ view, state, pos }) => {
    const at = state.doc.nodeAt(pos)
    if (at?.type.name !== 'footnoteReference') return []
    return [
      {
        kind: 'action',
        id: 'footnote-go',
        label: 'Go to footnote',
        run: () => {
          /* a command over view.state and view.dispatch */
        },
      },
    ]
  },
}
```

Pass it to `DocumentEditor`'s `contextMenuContributions` prop, or add it to `builtInContextMenu` in `built-in-contributions.ts` for Quill's own features. The registry refuses two contributions with one id.

Entries are `action` (with an optional `shortcut`, `icon`, `tone: 'danger'` and `checked` for a setting that is on or off), `choice` (one of several options, such as a callout's type) and `submenu` (actions and choices under a name). An entry that cannot act now gives a `disabledReason`, shown under its label: frequently used entries are disabled with their reason rather than hidden (`docs/design/feedback.md`, "Disable or hide"). Each `run` is one command, so one undo step.

**The browser's own menu stays one modifier away.** Quill's menu replaces the browser's only inside the writing surface, and Shift with a right-click opens the browser's own menu there too. That is where its spelling suggestions, "Inspect" and other extensions' entries are. Everywhere outside the writing surface, a right-click is the browser's.

### What you cannot do

- Change how core CommonMark or GFM syntax parses.
- Read or change nodes your extension does not own.
- Use the clock, randomness, the network or the file system while rendering. For the same source and version, rendering must give the same output every time.
- Run code from a document. Authors get syntax, never expressions.

## The reference extension: draw.io

draw.io diagrams (ADR-043) are the first feature built to this contract, and every later extension copies their shape: one `drawio` module per package boundary, each part where the contract says it goes, nothing outside them knowing draw.io exists.

| Part | Where | What it is |
| --- | --- | --- |
| The declaration | `packages/markdown/src/extensions/drawio/drawio-extension.ts` | The `MarkdownExtension`: id, version, the drawing it claims, how it renders, its grant (two data attributes), and its editor binding (an insert entry and an "Edit diagram" action) |
| Reading | `packages/markdown/src/extensions/drawio/drawio-svg.ts` | Recognises a `.drawio.svg`, strips its embedded source, and chooses one of the platform's renderings: the SVG allowlist at its own size, or an `<img>` of the file when its labels are HTML |
| The file format | `packages/markdown/src/extensions/drawio/drawio-file.ts` | Reads the embedded diagram and its labels within fixed limits; inflating is injected (`Inflate`) |
| Search | `packages/application/src/ports/drawing-text.ts`, `apps/server/src/extensions/drawio/drawing-text.ts` | A port the attachment intake asks on upload and revision; the server's adapter inflates with zlib's own cap |
| The editor binding | `packages/editor/src/extensions/drawio/drawio-binding.ts` | The slash item and the image action, named by the declaration; small, in the editor's main chunk |
| The editing session | `packages/editor/src/extensions/drawio/` (`@quill/editor/drawio`) | The draw.io protocol adapter, the session state machine and the overlay; a lazy chunk |
| The application | `apps/web/src/features/documents/drawio/` | Opens the session, implements the attachments port it needs, puts what was saved into the document |
| The server | `apps/server/src/extensions/drawio/` | `DRAWIO_URL`, the CSP `frame-src` it implies, `GET /api/extensions/drawio` |

The registry (`createMarkdownRegistry(extensions)`) is built at the composition root — the server's document format — and hands the renderer the drawing each extension claims. An extension never builds output itself: `render` returns a `DrawingRendering` (`inline` markup for the allowlist, or `image`), and the platform makes the markup, keeping only the data attributes the grant names. The installed ids and versions join the render cache key.

### The external editor frame

An extension whose editor is someone else's application — draw.io now, Figma or others later — embeds it with the generic external editor frame in `packages/editor/src/embedded-frame`, and writes only a protocol adapter:

- `createFrameChannel` (framework-free) accepts a message only from the configured origin **and** the frame's own window, decodes it with the adapter's codec, and validates it against the adapter's TypeBox schema; anything else is dropped and reported. It posts only to that origin, never `'*'`.
- `useFrameChannel` opens the channel for a component's life, with the handlers as effect events, and reports an editor that never answers.
- `EmbeddedEditorFrame` is the reading surface's lightbox shell (the native `<dialog class="lightbox">`) with a bar naming the editor, the frame with the adapter's sandbox, and a place for the session's questions (`EmbeddedEditorPrompt`). Its Escape is a request: the session decides whether closing would lose work.
- The adapter supplies the address, the sandbox — each token documented where it is chosen — the schemas and the session, as a reducer with discriminated-union states (`drawio-session.ts`).

## Adapted plugins

To reuse a remark or rehype plugin from the ecosystem:

```ts
import { adaptRemarkPlugin } from '@quill/markdown/extension'
import remarkSomething from 'remark-something'

export default adaptRemarkPlugin(remarkSomething, {
  id: 'community.something',
  version: '2.3.1', // the plugin's version, pinned
  owns: ['something'], // the node types it creates and may touch
  sanitize: { span: { className: ['something'] } },
  // The editor binding defaults to the source island.
})
```

If the plugin turns out to be non-deterministic, or to change core syntax, the conformance kit fails it.

## Networked extensions (live blocks)

An extension that needs the network does not fetch while rendering. It declares a `live` binding, which is a live block type (ADR-032):

```ts
live: {
  attributes: StatusAttributes,                  // validated at parse time
  fetch: (params, { http, integration }) => ..., // on the server, via the SSRF-safe client, with an integration's credentials
  cadence: { kind: 'on-view', ttl: '30s' },      // or 'scheduled' or 'push'
  renderSnapshot: (snapshot, h) => ...,          // static HTML with an "as of" time, for export and crawlers
  island: () => import('./status-island.tsx'),   // the live view in the app
}
```

The document body renders a slot, which is cacheable and deterministic. The page fills it from the latest snapshot, and the app keeps it fresh at the declared cadence. A failing source shows its last good snapshot, never an error. The fetcher runs with the integration's credentials, never the reader's, and a live block only displays data: it never acts.

## The conformance kit

Every packaged or adapted extension must pass:

```ts
import { describeExtension } from '@quill/markdown/testing'
import extension from './index.ts'
import corpus from './corpus/index.ts'

describeExtension(extension, corpus)
```

The kit checks that:
- **It round trips:** Markdown → editor → Markdown, byte for byte, across the corpus.
- **It degrades:** the source reads sensibly with the extension uninstalled.
- **It is safe:** the sanitiser's attack corpus cannot get past the extension's grant.
- **It is deterministic:** rendering twice gives the same output.
- **It leaves core syntax alone:** the shared corpus parses identically with and without it.
- **It is accessible:** axe passes on its rendered output and its editor view.
- **It is fast enough:** its cost stays within the reading budgets.

A production build refuses to register an extension that fails.

## Versioning

An extension's `id` and `version` are part of the render cache key, so upgrading it re-renders only the documents that use it. Treat the Markdown it accepts as a persisted format (AGENTS.md rule 17): new attributes are optional, old documents keep rendering, and a breaking change is a new directive name, not a new meaning for an old one.
