# @quill/highlight

Syntax highlighting for Quill (ADR-030): one Prism tokenizer, one range
model, two presentations.

- **Core** (`@quill/highlight`) is DOM-free — safe on the server and in a
  worker. `resolveLanguage`/`SUPPORTED_LANGUAGES` map fence names to
  grammars, `tokenize` walks a grammar into tiled `TokenRange[]`,
  `packRanges`/`unpackRanges` give a compact attribute-safe transport form
  (versioned: a reader dispatches on the prefix and refuses a version it has
  never shipped, ADR-033), `toMarkup` renders escaped spans, and `highlight`
  is the cached facade producing both. `tokenCssContract`,
  `grammarTokenGroups` and `REVIEWED_UNTHEMED_GROUPS` are the source of truth
  a theme's stylesheet and coverage test check against: coverage is measured
  on the class *groups* a token actually wears (a rule's name plus its
  aliases), and every group that resolves to no colour is listed and reviewed
  rather than filtered away.
- **Client** (`@quill/highlight/client`) is DOM-facing. `applyHighlighting`
  finds `pre > code[data-tokens]` and paints ranges via the CSS Custom
  Highlight API, or swaps in markup where that API is missing. A block whose
  attribute cannot be read is left plain and the rest of the page still
  highlights. DOM access goes through an injected environment: apps wire the
  real `window`, tests use plain fakes.

Offsets are UTF-16 units into the code block's text exactly as the DOM holds
it, which is why `@quill/markdown` normalises a document's line endings to
`
` at parse: an HTML parser collapses `
`, so ranges counted over the
`` would land a character further along on every line after the first.
