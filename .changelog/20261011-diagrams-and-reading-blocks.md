Added: Mermaid diagrams are drawn in the reader, coloured from the theme and redrawn when it changes, with the source kept for readers without JavaScript.
Added: SVG drawings can be uploaded and are drawn inline in documents through a strict allowlist, styled by a small class vocabulary that follows light and dark.
Added: Badges (`:badge[Built]{tone=success}` and the `:ok`, `:warn`, `:bad`, `:accent`, `:plan` shorthands), small print, captioned figures and card grids in documents.
Added: GitHub alerts (`> [!WARNING]`) render as callouts, and callouts are styled in the reading view.
Changed: A paragraph written just before a document's title is set as its eyebrow, and drawings and tables of four or more columns are wide by default.
Security: SVG uploads are accepted as drawings but only ever served as sandboxed downloads; readers see them only after the renderer's SVG allowlist (ADR-011 amendment, ADR-036).
Fixed: In-page links written for GitHub (`[the loop](#the-loop)`) now reach their heading, and heading anchors keep underscores and repeated spaces the way GitHub's do.
Fixed: Badges look the same in the editor as they do to a reader, instead of showing as plain text.
Fixed: A paragraph wrapped across lines in its Markdown source reads as one line in the editor, as it does to a reader, instead of breaking where the source wrapped.
Added: A start-aligned reading layout (`data-align="start"`) that sets the text column beside the navigation, with wide blocks breaking out to the right only.
