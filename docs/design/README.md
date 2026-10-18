# Design

## Screens canvas

`canvas/` holds the working files for the screens canvas: one `.dc.html` artboard per surface (reading, writing, presenting as a public site, reading on a phone) and `canvas.json` for layout and notes. They are the source; the published canvas is assembled from them and is not committed.

Published canvas: https://claude.ai/code/artifact/4ca264a7-7d05-474d-a833-0eb658e8f3fb

The artboards match the design system in `packages/ui` (type scale, control heights, radii, the content/wide/full layout grid) and expose three theme tweaks above each screen: tone, accent, and reading typeface. Those are the same levers the product's workspace theme will offer (see `quill-plan.md`, section 29).

To change a screen, edit its working file here and re-assemble the canvas; never edit the published page directly.

## Design system showcase

The living design system is in `packages/ui`, with a showcase at `/design` in the web app (`pnpm dev`, then open the design route). The research write-up with the primitives, typography, token, and contrast decisions is `docs/research/r13-frontend.md`.

## Reading chrome

[`chrome.md`](chrome.md) sets the rules for the frame around a document while
it is read: one face, three inks, section labels as small headings, a soft
selection for "you are here", and the order things give way as the bar
narrows.

## Feedback

[`feedback.md`](feedback.md) sets the vocabulary for inline status, toasts, and blocking dialogs, and when a promise toast is the right way to show background work that concerns the current page.

## Document properties

[`properties.md`](properties.md) sets what a document's properties are for,
the byline every surface shows under a title, who sees which facts, and how an
author edits them in place.

## Search

[`search.md`](search.md) describes the search experience: the anatomy of a result, filter chips, typeahead, the states and keys of the palette and the results page, and what is deliberately not there yet.

## Home

[`home.md`](home.md) defines the three first pages (signed-in home, workspace home, public site home), who each is for, and what M2 ships of them.

## Templates

[`templates.md`](templates.md) sets how editing a template is told apart from editing a document, the wording for publishing and sharing a template, the template panel on a document made from one, and the gallery.

## Product

[`../product/`](../product/README.md) holds the personas, the use cases with their acceptance criteria, and the surface map these screens are designed against.
