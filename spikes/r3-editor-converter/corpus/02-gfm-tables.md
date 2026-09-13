# Tables with alignment

Source: written for this spike, structured after the table examples in the GitHub Flavored Markdown spec.

Default alignment:

| Command | Description |
| --- | --- |
| `pnpm check` | Runs the full quality gate |
| `pnpm dev` | Starts the server and the web app |

All four alignments in one table:

| Left | Centre | Right | Default |
| :--- | :----: | ----: | ------- |
| a | b | c | d |
| a longer cell | centred | 42 | plain |

Inline formatting inside cells:

| Field | Type | Notes |
| :-- | :-: | --: |
| `id` | **string** | *Required* |
| `title` | `string` | See [front matter](#front-matter) |
| `tags` | `string[]` | ~~deprecated~~ |

A ragged table where a row has fewer cells than the header:

| One | Two | Three |
| --- | --- | --- |
| a | b |
| a | b | c |

A cell containing an escaped pipe:

| Pattern | Meaning |
| --- | --- |
| `a \| b` | alternation |
