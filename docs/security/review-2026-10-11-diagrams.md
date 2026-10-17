# Security review: diagrams and reading blocks (2026-10-11)

Scope: ADR-036. Rendering (badges, figures, cards, GitHub alerts, Mermaid slots, inline SVG drawings), uploads (SVG accepted as a drawing), and the web app's Mermaid drawing pass. Checked against `docs/security/checklist.md`.

## Rendering

- **Server-side sanitising before caching.** Every new element the renderer emits is listed in `sanitize-schema.ts` with the handler that emits it, and every new attribute value is an enumerated list (`data-tone` is one of the badge tones, `data-variant` one of the card variants, `data-diagram` one of `mermaid` and `svg`). An unknown tone or variant degrades to the default in `parse`, so nothing an author writes reaches an attribute verbatim. `render.security.test.ts` still passes unchanged.
- **Inline SVG.** `drawing.ts` is an allowlist, not a filter: nineteen elements, attributes checked value by value, `url()` admitted only as `url(#id)` into the same drawing and rewritten to the prefixed id, every id prefixed `user-content-d<n>-` so a drawing can neither clobber an application id nor capture another drawing's markers, and a 20,000-element cap. `drawing.test.ts` holds the adversarial corpus: script, event handlers, `javascript:` links (including entity-encoded), `foreignObject`, external `image` and `use`, animations that rewrite links, external and `javascript:` paint servers, `style` attributes and elements, CSS expressions, and attribute break-outs. Drawings are placed after the document sanitiser into slots only the renderer emits; `reading-blocks.test.ts` proves an author's raw HTML naming the slot stays text.
- **Scope.** The application reads drawings with one query constrained to the document's own workspace and to live rows (`listLiveInWorkspace`), so a body cannot draw another workspace's file whatever URL it names (`render-document.test.ts`).

## Uploads

- `image/svg+xml` is now accepted. It is not stripped (it is text, and the renderer's allowlist is what makes it safe to show), it is served with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and the attachment `sandbox` policy, and never inline (`isInlineMediaType`). Integration test: `attachments.integration.test.ts`, "accepts an SVG drawing and serves it only as a sandboxed download".
- Drawings over 1 MiB are not drawn; the upload cap is unchanged.

## Headers and the client

- **No `'unsafe-inline'`.** Mermaid writes a `<style>` element and `style` attributes, which the CSP refuses. `draw-diagrams.ts` parses Mermaid's output in an inert document, lifts both out, adopts the stylesheet through `document.adoptedStyleSheets`, and applies each style with `style.cssText`. Verified in a browser under `style-src 'self'`: adopted sheets and `cssText` apply, while a `<style>` element and a `style` attribute are refused. Mermaid's own measuring pass inserts a temporary `<style>` that the CSP refuses; that costs a console report, not a rendering difference, because text is measured through the CSSOM.
- Mermaid runs with `securityLevel: 'strict'` (labels sanitised with DOMPurify, click handlers and links refused) and `htmlLabels: false`.

## Supply chain

- New runtime dependencies: `mermaid` (web app, lazily loaded only on pages with a diagram), `hast-util-from-html` and `property-information` (Markdown package, the unified ecosystem's own parser and attribute table, already in the tree transitively).
- `pnpm audit --prod`: one new advisory, **GHSA-238p-pmpm-9mq7 (low)**, KaTeX prototype pollution bypassing `trust` restrictions, reached through `mermaid > katex@0.16`. Exception recorded: Mermaid pins `katex ^0.16` and the fix is in 0.18.2, a breaking 0.x line under Mermaid; Quill never enables KaTeX's `trust` option, and the advisory needs an existing prototype pollution to exploit. Revisit when Mermaid moves to KaTeX 0.18.
- The twelve other advisories `pnpm audit --prod` reports (fastify, fast-uri, ip-address, brace-expansion, nodemailer) predate this change and are all in server dependencies; they are flagged for their own task.
