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
