# Design

## Screens canvas

`canvas/` holds the working files for the screens canvas: one `.dc.html` artboard per surface (reading, writing, presenting as a public site, reading on a phone) and `canvas.json` for layout and notes. They are the source; the published canvas is assembled from them and is not committed.

Published canvas: https://claude.ai/code/artifact/4ca264a7-7d05-474d-a833-0eb658e8f3fb

The artboards match the design system in `packages/ui` (type scale, control heights, radii, the content/wide/full layout grid) and expose three theme tweaks above each screen: tone, accent, and reading typeface. Those are the same levers the product's workspace theme will offer (see `quill-plan.md`, section 29).

To change a screen, edit its working file here and re-assemble the canvas; never edit the published page directly.

## Design system showcase

The living design system is in `packages/ui`, with a showcase at `/design` in the web app (`pnpm dev`, then open the design route). The research write-up with the primitives, typography, token, and contrast decisions is `docs/research/r13-frontend.md`.

## Feedback

[`feedback.md`](feedback.md) sets the vocabulary for inline status, toasts, and blocking dialogs, and when a promise toast is the right way to show background work that concerns the current page.

## Home

[`home.md`](home.md) defines the three first pages (signed-in home, workspace home, public site home), who each is for, and what M2 ships of them.

## Product

[`../product/`](../product/README.md) holds the personas, the use cases with their acceptance criteria, and the surface map these screens are designed against.
