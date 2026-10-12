# The Markdown Quill reads and writes

Quill documents are Markdown files in Git (ADR-002). What you write is what is stored: the editor opens a file, and saves it back in the form you wrote it, changing only what you changed and collapsing soft line wraps once. This page says what is understood, what the editor shows for it, and how it reads anywhere else.

Everything here works in the editor, on the reading surface, in the public site and in exports. Nothing is reading-only (ADR-039).

## Standard syntax

| Syntax | Notes |
| --- | --- |
| **CommonMark**: headings, paragraphs, emphasis, strong, links, images, lists, quotes, code spans, fenced code, thematic breaks, hard breaks | Headings get permalinks the way GitHub makes them. |
| **GitHub Flavored Markdown**: tables, task lists, strikethrough, automatic links for bare URLs, footnotes | A table keeps its alignment row, and a task list its checkboxes. See [tables](../architecture/decisions/0040-tables.md). |
| **Front matter**, a YAML block at the top | Unknown keys are kept as written (ADR-005). The editor shows the properties it knows as a strip above the page. |
| **Raw HTML** | Shown as text, never run (ADR-011). The one exception is the `<details>` shape below. |

## Callouts, however you write them

A quote that opens with `[!kind]` is a callout, and so is the directive. All of these are one thing in the editor, and each is saved in the form you used.

| You write | Reads as | Notes |
| --- | --- | --- |
| `> [!NOTE]` then the body | GitHub's alert | Kinds `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`, in any case. Titled by its kind. |
| `> [!tip] Before you begin` then the body | Obsidian's callout | The rest of the first line is its title, which may be formatted. |
| `> [!faq]`, `> [!bug] Known issue` | Obsidian's other kinds | Drawn as the nearest of Quill's six; a kind nobody knows is drawn as a note. The kind you typed is kept. |
| `> [!tip]-` or `> [!tip]+` then the title | Obsidian's foldable callout | Closed or open. A foldable callout is a details (below). |
| `:::callout[Title]{type=warning}` | Quill's directive | Types `note`, `info`, `tip`, `important`, `warning`, `caution`. Can say everything. |

A callout you make in the editor is written as the quote (`> [!TIP]`), because that is the standard form and GitHub and Obsidian both read it. Quill's own `:::callout` is kept for documents that were written with it, and for anything the quote cannot say. Changing a callout's type writes the kind it is now, in the case you used; giving a GitHub alert a title writes it the way Obsidian does, `> [!NOTE] Title`, which GitHub shows as a plain quote.

To every other parser, the quote forms are quotes and the directive is its title and body in plain paragraphs.

## Details and accordions

- `:::details[Summary]{open}`, Quill's directive.
- `<details>` and `<summary>`, in GitHub's exact shape, which is also what Docusaurus and Starlight write.
- Obsidian's foldable callouts, above.
- `::::accordion` around several details makes them exclusive.

## Quill's directives

A directive is `:name[label]{attributes}` inline, `::name` as a block, or `:::name` around blocks. An unknown one is kept and shown as its label and body, so a document written for a newer Quill still opens (ADR-002).

| Directive | For |
| --- | --- |
| `:::wide`, `:::full` | A block at a breakout width (ADR-027). |
| `:::table{width=… headers=… footer=…}` | A table's options and caption (ADR-040). |
| `:::figure` | A block with a caption. |
| `:::cards` | Sections side by side. |
| `:::code-group` | Tabs of code blocks, one per language (ADR-041). |
| `:badge[Built]`, `:ok[…]`, `:warn[…]`, `:bad[…]`, `:accent[…]`, `:plan[…]` | Status pills. |
| `:kbd[Ctrl+K]`, `:small[…]` | A key, small print. |
| `::toc`, `::children` | A table of contents, and the documents beneath this one. |
| `:acme[Acme]`, `:acme:` | Your organisation's labels and emoji (ADR-037, ADR-038). GitHub's emoji shortcodes work without setup. |
| `:::guidance`, `:::optional`, `:::when`, `:::repeat`, `:::placeholder` | Template blocks (ADR-029). |

## What is not supported

MDX and JSX (ADR-032), raw HTML beyond the `<details>` shape, and syntax that CommonMark reads differently (VitePress `::: details`, Material for MkDocs `???`). Those can be imported into the forms above.

## Extending it

[Extending Quill's Markdown](../extending/markdown-extensions.md) covers how to add syntax, which must work on both surfaces and degrade to plain Markdown.
