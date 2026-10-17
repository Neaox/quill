# ADR-043: Figma and draw.io

**Status:** Accepted
**Date:** 2026-10-11
**Delivery:** M5, with source artifacts and embeds (quill-plan.md section 20), pulled forward if a customer needs it sooner
**Related:** ADR-002 (Markdown is canonical), ADR-008 (providers and integrations), ADR-011 (security baseline), ADR-032 (live blocks), ADR-036 (diagrams), ADR-039 (Markdown extensions), ADR-042 (link previews)

## Context

Architecture and product documentation leans on two tools above all others: **draw.io** (diagrams.net) for system diagrams and **Figma** for designs. The owner wants both supported first class: as good as Confluence's draw.io and Figma apps, or better.

That means:
- a diagram or design shows as a crisp image in the reader, in light and dark, on the public site and in exports;
- the reader can open it full screen;
- an author can create and edit a draw.io diagram without leaving the document;
- a Figma frame stays current with the design;
- the Markdown still reads sensibly in Git.

Quill already draws inline SVG through an allowlist (ADR-036), opens diagrams in a lightbox, and plans live blocks (ADR-032), link previews and an embed allowlist (ADR-042).

## Decision

### draw.io: the diagram is the file, and the file is an image

**Storage.** A draw.io diagram is an attachment in the document's workspace, saved as **`.drawio.svg`**: an SVG that carries the diagram's XML inside it, so the one file is both the picture and the editable source. This is the convention draw.io itself, GitHub and VS Code's draw.io extension use. Plain `.drawio` files are accepted on upload and converted, and `.drawio.png` is read but not written.

**Markdown** stays an ordinary image, which degrades everywhere and renders on GitHub:

```markdown
![Payments: request flow](attachments/payments-flow.drawio.svg "How a payment moves")
```

**Reading.**
- The SVG goes through ADR-036's drawing pipeline, so it is drawn inline, takes the theme's colours where the author used the class vocabulary, and opens in the lightbox.
- draw.io writes labels as HTML inside `foreignObject` by default, which the allowlist refuses. Quill saves diagrams with draw.io's "convert labels to SVG" export, so text is real SVG text: selectable, searchable and safe.
- An uploaded file that still holds `foreignObject` labels falls back to being shown as an `<img>` of the original, never inline. It keeps its text visually, and the editor offers to re-save it in the safe form.

**Search** indexes the diagram's labels, taken from the embedded XML on upload.

**Writing.** Quill embeds the draw.io editor in **embed mode**, an iframe speaking draw.io's documented `postMessage` protocol:
- **Insert and edit.** "Insert → Draw.io diagram" from the slash menu and toolbar, or "Edit diagram" on an existing one, opens the editor full screen over the document with the diagram loaded.
- **Save.** Save writes a new revision of the attachment (`.drawio.svg`, labels as SVG) and updates the image in place. The document gets a revision only if the image's address changes; the attachment carries its own history.
- **Where the editor runs.** By default the instance serves a **self-hosted** copy of the draw.io web app (Apache-2.0) from its own origin, isolated on a separate path or subdomain, so diagrams never leave the instance. An operator may point at `embed.diagrams.net` instead; that is an explicit setting, documented as sending diagram contents to a third party.
- **Safety.** The iframe is sandboxed to what embed mode needs. Messages are accepted only from that origin, and with the expected message shapes, validated.
- **Concurrency.** The attachment carries a version; saving over a newer version offers "Save as copy" or "Reload", never a silent overwrite.

### Figma: a link, a live snapshot, and an embed

**Markdown** is the Figma URL, optionally with a display choice (ADR-042's link directive):

```markdown
::figma{url="https://www.figma.com/design/<file>/<name>?node-id=12-34" display=image}
```

A bare Figma URL takes the organisation's default display. Outside Quill it reads as the link.

**Three displays:**
1. **Card:** the file name, frame name, thumbnail and last-edited time, via ADR-042. Figma supports oEmbed for public files; private files need the connector.
2. **Image (the default when a connector is set):** a rendered PNG or SVG of the linked frame. It is fetched through the **Figma connector**, the REST API's image export with an organisation-scoped token, never the reader's. It is stored in the blob store as a live-block snapshot (ADR-032):
   - refreshed on a cadence, and on Figma's `FILE_UPDATE` webhook where configured;
   - shown with "Updated <time> · Open in Figma";
   - opened in the lightbox at full resolution.

   This is what exports, the public site and readers without access to Figma see.
3. **Embed:** the interactive Figma embed (`https://www.figma.com/embed?…`), from ADR-042's embed allowlist, sandboxed and lazy. It works only for readers whom Figma itself authorises, so it is never the only display. The snapshot is shown until the embed loads, and instead of it when Figma refuses.

**Permissions.** A snapshot is visible to whoever can read the document, so the connector must be granted to the workspace explicitly, and the editor says plainly "Everyone who can read this page will see this frame". The public site shows a Figma image only if the organisation allows connector content there (ADR-042's policy).

**Writing.**
- Pasting a Figma link offers "Show as image / card / embed / link".
- A small toolbar on the block changes display, picks the frame (from the file's pages and frames via the connector), refreshes, and opens in Figma.

### Both are extensions

Both are packaged extensions under ADR-039:
- **draw.io:** an image node with an editor binding that opens the embed editor;
- **Figma:** a link-display extension with a `live` binding.

They use the shared viewer (lightbox), the snapshot store and the embed allowlist. Neither adds a parallel mechanism.

### What delivery of steps 1 and 2 established (2026-10-11)

Verified against draw.io 32.4 (`jgraph/drawio:32.4.1`, the Compose service):

- **"Convert labels to SVG" is a cell style, not an export option.** In draw.io 32 it is `convertToSvg=1` on each cell (with `svgWhiteSpace=wrap` for a wrapping label); `export` with `format: 'xmlsvg'` has no switch for it. Quill sets it on every shape and line when it opens a diagram, configures it as the default style for new ones, and — because a shape dragged from the sidebar brings its own style — converts and reloads (`load`) a saved diagram that still has an HTML label before asking for the export. `merge` would keep the writer's view but resolves a shape added since the load in favour of its own copy, so it is not used. Vertical text still comes out as `foreignObject`; that file reads as an image.
- **The export** is `{ action: 'export', format: 'xmlsvg', asText: true, embedFonts: false }`, answered by `{ event: 'export', format: 'svg', data: <the SVG> }` with the diagram in the root's `content` attribute, compressed (URI-encoded, raw deflate, base64).
- **Adaptive colours.** draw.io 32 writes a diagram's light and dark colours as `light-dark()` in `style` attributes and leaves the shape background to its own stylesheet (`var(--ge-adaptive-bg)`). The allowlist now reads a `style` declaration as the presentation attribute it would keep, and admits `light-dark(<colour>, <colour>)` with each half checked as a colour; the extension writes the adaptive background out as `light-dark(<light>, #121212)`. A diagram drawn with fixed colours is marked `data-drawio="fixed"` and set on paper in the dark.
- **The image fallback** covers HTML labels (`foreignObject`) and embedded pictures (`image`), which the allowlist would otherwise drop silently. It is marked `data-drawio-legacy`; editing such a diagram here converts its labels on open.
- **Diagrams are drawn at their own size**, never stretched past it, and shrink to fit.
- **Revisions.** An attachment has a `version`; `PUT /api/attachments/:id?expectedVersion=n` writes a new revision under the same id and URL, keeps the state it replaced in `attachment_revisions`, and answers `409 attachment_version_conflict` with the current attachment when a newer one exists. A revision keeps its media type. An `AttachmentRevised` outbox event re-indexes the published documents that show it and refreshes the public site's cache, because their bodies change without a publish. The editor draws a re-saved diagram from `?v=<version>` so the browser's five-minute cache does not show the old one; the Markdown keeps the plain address.
- **Search** keeps a drawing's labels on its attachment (`search_text`), read on upload and on each revision, within fixed limits: 8 MiB inflated per file (the cap is zlib's own `maxOutputLength`), 100,000 elements, 100 pages, 64 KiB of text. A file past any limit is stored and drawn, and has no words.
- **Where the editor runs.** `DRAWIO_URL`, defaulting to the Compose service while the app is on loopback; a real deployment names it or has no editor. diagrams.net's hosts are refused unless `DRAWIO_ALLOW_THIRD_PARTY=true`, and the editor tells a writer when it is diagrams.net's. The frame is sandboxed to `allow-scripts allow-same-origin` — the second so the frame keeps its own origin, which the message check depends on — which is safe only because the editor is never on the app's origin; the server refuses that at boot. The CSP's `frame-src` is generated from the configured origin.
- **`.drawio` uploads** are accepted as `application/vnd.jgraph.mxfile`, served as a download, and read for search; the editor imports one by dragging it into draw.io. A **`.drawio.png`** is an ordinary PNG to the platform, and its metadata stripping removes the embedded diagram, so it is a picture only.
- **The document's own diagrams** are what the editor offers to edit: its attachments named `.drawio.svg`. A diagram attached to another document and shown here reads, but is edited from its own document.

## Alternatives considered

- **Store `.drawio` XML in the document and render it server-side.** Rendering needs draw.io's own JavaScript in a headless browser on the server, and the Markdown would be unreadable. `.drawio.svg` gives a picture everywhere for free.
- **Mermaid instead of draw.io.** Mermaid is already supported (ADR-036) and serves text-first authors. It doesn't replace hand-laid-out system diagrams, which is what draw.io users want.
- **Only the Figma iframe embed.** It shows nothing to readers Figma doesn't authorise, nothing in exports, and nothing on the public site. A snapshot with the embed as an upgrade covers every reader.
- **A hosted draw.io editor by default.** Convenient, but it sends every diagram to a third party. A self-hosted copy is the safe default for a self-hosted product.

## Consequences

- draw.io diagrams are ordinary attachments that open in draw.io, VS Code and GitHub, so there is no lock-in.
- The self-hosted draw.io editor is a static asset bundle the instance serves. It adds weight to the deployment, not to the reading bundle, because it is loaded only when editing.
- Figma's live images depend on the connector, the job runner and the snapshot store (M5).
- A new security surface: postMessage with the draw.io frame, and the Figma webhook's signature verification. Both go on the security checklist.

## Delivery

1. Reading `.drawio.svg` through the drawing pipeline, with the `img` fallback and label indexing. This is small and can come early.
2. The draw.io embed editor: insert and edit, save as an attachment revision, the self-hosted bundle, and settings.
3. Figma cards via ADR-042.
4. The Figma connector, image snapshots, the webhook refresh, and the embed upgrade.
