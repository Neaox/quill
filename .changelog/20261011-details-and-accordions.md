Added: Details and accordions: `:::details[Summary]{open}`, GitHub's `<details>`/`<summary>` HTML (which showed as escaped tags before) and Obsidian's foldable callouts (`> [!note]-`) render as the browser's own collapsible sections, written back in the syntax the author used (ADR-048).
Added: `::::accordion` (or a shared `name=`) makes details exclusive, so opening one closes the others; `type=warning` folds a callout.
Added: A link, a text fragment or the browser's find into a closed section opens it, and printing shows every section open.
Added: The editor shows a details with an editable summary and body, a chevron that hides the body while writing without changing the document, and an "Open by default" switch; "Details" (also found as "expand" and "toggle") and "Accordion" are in the slash menu, and `+++` and a space makes one.
Added: Converters from MkDocs `???`, VitePress `::: details` and Fumadocs and Mintlify accordion components into details, ready for the importer.
