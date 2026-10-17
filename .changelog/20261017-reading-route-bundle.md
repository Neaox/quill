Changed: opening a document downloads about 15% less before the page appears: 220 KB gzipped instead of 257 KB, well inside the 250 KB budget.

Changed: Menus, dialogs, tooltips and the history popover draw their closed controls straight away and load the rest while the page is idle. A control pressed before that has finished still opens, and a keyboard-opened menu still starts on its first item.
Changed: Syntax colours, diagrams and animated emoji are applied from their own small download, which starts with the page. Code blocks, tables and details are set up with the text, so nothing moves.
Changed: The Move, Delete and Attachments dialogs, and the collection dialogs in the sidebar, load when they are first needed.
Changed: `pnpm check:bundle` now also fails if the editor, the overlays, the deferred document enhancements or these dialogs get bundled into the code a document needs before it can appear.
