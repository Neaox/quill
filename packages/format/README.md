# @quill/format

The `DocumentFormat` adapter (ADR-062, "One truth"): how a document is parsed, rendered, inspected and compared, over `@quill/markdown` and `@quill/highlight`.

It was moved out of `apps/server` unchanged, so the server and the command-line tool run the same code:

- `document-format.ts`: the adapter, `createDocumentFormat`.
- `document-title.ts`: the title a document carries, and retitling one.
- `required-sections.ts`: which required sections are still empty (ADR-029).
- `highlighter.ts`: the ADR-030 highlighter the renderer takes as an option.
- `drawing-text.ts`: a draw.io drawing's words, for search (ADR-043).
- `document-work-pool.ts`, `document-work-worker.ts` and `parsed-trees.ts`: the sync's inspections and renders on a bounded pool of threads, each document parsed once (ADR-062, step 3).
- `document-work-bundle.ts`: the build entry (`@quill/format/build`) that writes the worker thread as one module.

It imports nothing from an app, the content store, search, the UI or the editor, and none of the server's runtime (`.dependency-cruiser.cjs`, `format-is-portable`).
