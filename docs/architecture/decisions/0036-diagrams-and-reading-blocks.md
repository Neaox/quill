# ADR-036: Diagrams and reading blocks

**Status:** Accepted
**Date:** 2026-10-11
**Related:** ADR-002 (Markdown is canonical), ADR-011 (security baseline, amended by this ADR), ADR-027 (block layout widths), ADR-030 (syntax highlighting), ADR-031 (render caching), quill-plan.md sections 16 and 20 (source artifacts, M5)

## Context

Architecture documents explain mechanisms, and the clearest of them are half pictures: a system map, a sequence of calls, a grid of options side by side, a table whose cells open with a status. The documentation Quill is meant to host — lockstay's 186-document portal is the first real one — is written that way: hand-drawn SVG diagrams styled by a small class vocabulary, `:ok[Built]` status labels in table cells, GitHub alerts (`> [!WARNING]`) as callouts, and figures with captions. Quill rendered none of it: SVG uploads were refused (ADR-011, amendment of 2026-09-13), a Mermaid fence was a code block, and there was no way to say "this paragraph captions that table" or "these four sections sit side by side".

Plan section 20 schedules Mermaid and Draw.io as source artifacts in M5. The owner asked for diagrams now, chose Mermaid for text-first diagrams, and chose inline SVG as well once it was clear that hand-drawn diagrams are what real documents carry.

## Decision

**Mermaid is drawn in the reader.** A ` ```mermaid ` fence renders as a diagram slot that holds its source (`<div class="diagram" data-diagram="mermaid"><pre><code>…`). The web app loads Mermaid only when a page has a slot, as its own chunk, and draws into it after the body is mounted (`apps/web/src/lib/diagrams`). The server cannot draw one — Mermaid lays text out with a browser's font metrics — so the source is what a reader without JavaScript, the public site and an export see, which is what Mermaid is written to be readable as. Mermaid runs with `securityLevel: 'strict'`. Its stylesheet and `style` attributes are moved out of markup (adopted through the CSSOM and applied as `style.cssText`), because the CSP has no `'unsafe-inline'` (ADR-011) and the browser would otherwise refuse them. It is coloured from the page's tokens, resolved to literal colours when drawn, and drawn again when the theme or colour scheme changes. A drawing is set at its natural width, gives way to four fifths of it, and then scrolls sideways in its slot.

**SVG is drawn inline, through its own allowlist.** An image on its own line whose URL is an SVG attachment in the document's own workspace is drawn inline as a diagram, so it takes the page's colours in light and dark. `packages/markdown/src/render/drawing.ts` parses it in an inert tree and keeps only what a static diagram needs: shapes, text, markers, gradients and clip paths, with each attribute's value checked against the shape that attribute takes. Script, event handlers, links, `use`, `image`, `foreignObject`, animation, `style` elements and attributes, and every `url()` that does not point inside the drawing are removed. Every id is prefixed per drawing and every reference rewritten to match. The image's alternative text names the drawing (`role="img"`) and its title captions it. The drawing is placed after the document's own sanitiser has run, so that allowlist never admits SVG, and only into slots the renderer emitted; an author's raw HTML was escaped long before. The drawing's own stylesheet is removed; the reading stylesheet styles a fixed class vocabulary (`zone`, `box`, `send`, `receive`, `check`, `label`, … documented in `packages/design-css/src/prose.css`) from theme tokens.

The application reads the SVGs a body shows in one query scoped to the document's workspace, leaves out removed files and any over 1 MiB, and makes their hashes part of the render cache key (ADR-031), so replacing a drawing re-renders the body and nothing else does. `RENDER_VERSION` is 3.

**Reading blocks.** Four directives and one GitHub extension, each degrading to readable Markdown (ADR-002):

- `:badge[Built]{tone=success}`, and the shorthands `:ok`, `:warn`, `:bad`, `:accent`, `:plan`: a status pill whose words are the meaning and whose tone (the interface badge's tones) is emphasis. A body cell that opens with badges sets them on a line above its detail. A badge with no label is the author's own text (`status:ok`) and is written back as typed.
- `:small[…]`: small print, rendered as `small`.
- `:::figure`: a block and the paragraphs after it, as `figure` and `figcaption`.
- `:::cards{variant=panels|ruled}`: each heading at the shallowest level starts a card; outside Quill the sections follow one another.
- `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`: GitHub's alerts render as callouts titled with their kind. The Markdown is not rewritten; to every other parser it is a blockquote. `important` joins the callout types.

  *Amended 2026-10-12.* A quote opening with `[!kind]` followed by a space, a line ending or nothing is a callout whichever dialect wrote it: GitHub's alert (a kind alone on the line), or Obsidian's callout (`> [!tip] Title`, any kind, the rest of the line its title, in inline Markdown). An Obsidian kind is drawn as the nearest of Quill's types (ADR-048's table), and a kind nobody knows as a note. The editor models either as a `:::callout` container with an `alert` form that records the marker as typed, whether it stood alone, and whether it is in Obsidian's dialect, and writes the quote back byte for byte. The quote is the form a callout made in the editor is written in, and the standard one wherever it exists (GitHub's capitals for its five kinds, Obsidian's lower case and `[!kind] Title` for the rest), so a title is written after the marker even on a callout that began as GitHub's alert, which GitHub shows as a plain quote; Quill's `:::callout` is for the documents written with it and for what a quote cannot say. The foldable form (`[!kind]-`, `[!kind]+`) is ADR-048's details and is unchanged.

A paragraph immediately before the title is its eyebrow, and the reading stylesheet sets it as one; this needs no syntax.

**Widths.** A drawing, and a table, is `wide` by default when it is a direct child of the reading grid (ADR-027 amended): neither can be read at the measure. An explicit wrapper still decides. Every table is set in a focusable scroll container (`.table-scroll`), which the reading stylesheet draws as its card (render version 4; amended 2026-10-11, to match the reference portal, where every table is wide).

**ADR-011 amendment.** `image/svg+xml` is an accepted attachment type. It is stored as uploaded, served only as a download with the same `nosniff` and sandboxing policy as every attachment, never as a picture, and shown to readers only drawn inline through the allowlist above.

## Alternatives considered

- **Mermaid rendered on the server.** Needs a headless browser in the server image for text measurement. Rejected for now; M5's source-artifact work can add it behind the same slot, and the slot's source fallback is what makes that a later choice rather than a rewrite.
- **SVG shown as `<img>`.** Safe without a sanitiser, but an image is its own document: it cannot take the page's colours, so every diagram would be wrong in one of light or dark, and its text is not selectable or searchable.
- **SVG sanitised at upload and served inline.** Serves a file of ours as a page on our origin, however clean. Sanitising at render keeps one allowlist, applied wherever a drawing is shown, and lets it improve without rewriting stored files.
- **A general SVG allowlist through `hast-util-sanitize`.** Its schema is keyed by hast property names and treats every attribute alike; value-by-value checks per attribute are what keep `url()` and paint servers in the drawing, so a dedicated walker is smaller and easier to audit.
- **A diagram DSL of our own.** Novel without a substantial benefit over Mermaid and hand-drawn SVG, which authors already know (AGENTS.md rule 19).

## Consequences

- Documents written for GitHub and for lockstay's portal render in Quill with their diagrams, labels and alerts, without rewriting.
- Mermaid's bundle is paid only by pages that draw a diagram; the reading route's budget is unchanged.
- The SVG allowlist is security-relevant code with an adversarial test corpus (`drawing.test.ts`); widening it needs the same care as `sanitize-schema.ts`.
- The public site and exports show Mermaid as source until server-side drawing lands (M5). Inline SVG drawings are already part of the server-rendered body, so they appear there.
- Workspace-specific label colours (lockstay's `:airbnb` and `:booking` channel labels) are not expressible yet: a theme has no extra named colours. They render as written until one does.
