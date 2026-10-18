# ADR-048: Details and accordions

**Status:** Accepted
**Date:** 2026-10-11
**Related:** ADR-002 (Markdown is canonical), ADR-011 (security baseline), ADR-031 (render caching), ADR-036 (diagrams and reading blocks), ADR-039 (Markdown extensions), ADR-041 (code groups), ADR-044 (deep links)

## Context

Documentation hides detail a reader may not want: the full config file, the long stack trace, the answer to a question in an FAQ, the browsers a feature supports. Every platform readers know has a collapsible section for it, and documents that come to Quill already use one. Quill had none: GitHub's `<details>` was escaped to text, like all raw HTML (ADR-011), so a README's collapsible sections showed their tags.

The owner asked for first-class details and accordions, on both surfaces, at the bar set by Confluence's expand macro in the editor.

### What other platforms write

| Platform | Syntax | Markdown? | Open by default | Exclusive group |
| --- | --- | --- | --- | --- |
| GitHub | `<details>` and `<summary>` HTML, Markdown between them after a blank line | Raw HTML | `<details open>` | No |
| VitePress | `::: details Title` … `:::` | Container extension (markdown-it-container) | No | No |
| Material for MkDocs | `??? note "Title"` and indented content; `???+` starts open | Indentation-sensitive extension (pymdownx.details) | `???+` | No |
| Docusaurus | `<details>` and `<summary>` in MDX | MDX, the same shape as GitHub's | `open` | No |
| Fumadocs | `<Accordions type="single">` and `<Accordion title>` | MDX components | `defaultValue` | `type="single"` |
| Starlight | `<details>` and `<summary>`, styled by the theme | Raw HTML | `open` | No |
| Mintlify | `<AccordionGroup>` and `<Accordion title>` | MDX components | `defaultOpen` | No |
| Obsidian | `> [!note]-` (closed) and `> [!note]+` (open): a foldable callout | Blockquote extension | `+` | No |
| Confluence | The expand macro | Not Markdown | No | No |

## Decision

### What Quill reads, imports and writes

**Read live, and written back in the form the author used, byte for byte:**

- **Quill's container directive**, `:::details[Summary]{open name=faq type=tip}`. The label is the summary, in inline Markdown. `open` opens it for a reader by default, `name` makes it one of an exclusive group, and `type` draws it as that callout (below). It stays a container directive in the tree, so attribute spelling, fence lengths and the other directive tools apply unchanged.
- **GitHub's raw HTML**: `<details>` or `<details open>`, an optional `<summary>…</summary>`, Markdown after a blank line, then `</details>`. This is also what Docusaurus and Starlight write. Only that exact shape is read: the two tags in lower case, the bare `open` attribute, and a summary of text with no markup in it. Anything else — another attribute, an event handler, a tag in the summary, body text inside the HTML block, tags that do not balance — stays raw HTML and is escaped to text as before (ADR-011). Tags are recognised in the parsed tree, where CommonMark has already made them HTML blocks, so nothing about how core syntax parses changes (ADR-039). Several on one line (`</details>` closing two, or closing one and opening the next) are read too.
- **Obsidian's foldable callouts**: a blockquote whose first line is `[!kind]-` or `[!kind]+`, then the title. A non-foldable `> [!NOTE]` is still GitHub's alert (ADR-036).

The opening as written — the HTML with its spacing, the Obsidian marker in its case — is kept, with the blank lines around the body, and used for as long as it still says what the details says. A source form is dropped only when it cannot hold a change: GitHub's HTML has room for `open` and a one-line summary without a `<`; Obsidian's marker for a kind, `open` and a one-line title. A details given a name, or a summary that does not fit, is written as the directive instead, never in a form that would read back as something else.

**Imported, never read live** (`packages/markdown/src/import/details.ts`, pure string-to-string converters with fixtures from each platform, for the M4 importer):

- **Material for MkDocs** `???`, `???+`: CommonMark reads it as a paragraph and an indented code block, so reading it live would change how core syntax parses. Its kind becomes `type`.
- **VitePress** `::: details Title`: with the space it is no directive, and CommonMark runs the title, the body's first lines and the closing colons into one paragraph unless blank lines separate them. Recognising it in the tree, as ADR-041 does for `::: code-group`, would work only for documents that happen to be spaced out, so it is converted instead.
- **Fumadocs** `<Accordions>` and **Mintlify** `<AccordionGroup>`, with their `<Accordion title>`: JSX is not Markdown (ADR-032). A group becomes an accordion.

**Written, for a details made in the editor:** the directive. It is Quill's own syntax for every container (ADR-002), it can say everything (name, kind, inline Markdown in the summary), and outside Quill it degrades to its summary in brackets and its body.

### Accordions

`::::accordion` around several details makes them exclusive: opening one closes the others. It is the browser's own exclusive accordion, `<details name="…">`, with every details in the accordion given its name. An accordion may name itself (`{name=faq}`); otherwise each is named `accordion-1`, `accordion-2`, … in document order, which keeps rendering deterministic (ADR-039). Details elsewhere that share a `name` attribute form a group too, as they do in HTML. Where a browser does not group details by `name`, the reader's enhancer closes the others itself.

### Callouts

A foldable callout is a callout drawn as a details. A details with a `type`, from the directive or an Obsidian marker, carries the callout's classes and colour, and its summary defaults to the kind's name. Obsidian's other kinds map onto Quill's (`faq` → info, `bug` → caution, …); a kind nobody knows is a note, as an unknown callout type is.

### Rendering

The browser's own `<details>` and `<summary>`: it opens without script, is operated by the keyboard and announced correctly, and the browser's find can reach into it. Never a `div` and a button imitating one.

```html
<details class="details" open name="faq">
  <summary>Inline <strong>Markdown</strong></summary>
  <div class="details-body">…any blocks, other details included…</div>
</details>
```

A details without a summary is summarised by what it is: "Details", or its callout kind. An accordion is `<div class="accordion">` around its details.

**Styling** (`prose.css`, theme tokens only): a calm row ruled above and below, a chevron at its start that turns down as it opens (and does not animate under reduced motion), a hover and a focus-visible state on the summary, the body indented to the summary's words on the flow tokens. Details one after another share their rules, so an accordion reads as one list. The theme's `data-rules` decides the frame, as it does a table's: hairlines, the stronger rule under `double`, open space under `plain`, and raised cards under `cards`, where an accordion is one card ruled inside. Open is told by the chevron's direction, not colour. Opening and closing glide only where the browser can animate to `auto` (`interpolate-size` and `::details-content`) and are instant elsewhere. On paper every details is open.

**The enhancer** (`@quill/design-css/details`, in the public reader script and the signed-in reader):

- **Deep links** (ADR-044): a target inside a closed details — a heading, a block anchor, anything with an id — opens every details around it on load, on `hashchange` and when an in-page link is followed again, then is scrolled to. The renderer's `user-content-` prefix is tried too.
- **Text fragments**: a `#:~:text=` directive opens the closed details holding its text, read from the address where a browser without text fragments leaves it and from the navigation entry where one takes it off.
- **Find in page**: `beforematch`, which a browser fires before revealing a match hidden `until-found`, opens the details around it. Browsers that already expand a details for find do so natively.
- **Exclusive accordions** where `name` is not supported, and **print**, which opens everything and closes again what it opened.

It remembers nothing. Open is the document's default and then the reader's click; no store is read or written.

### Security

The sanitiser grant (`DETAILS_SANITIZE_GRANT`) admits the classes `details`, `callout` and `callout-<kind>` on `details`, `details-body` and `accordion` on `div`, `open`, and `name` only in a name's own shape (`^[A-Za-z0-9][\w-]{0,31}$`). `details` and `summary` are already in the default schema. `open` and `name` are removed from the default's every-element attributes, so the details grant is the only way either reaches a page. Raw HTML is still never parsed into elements: the HTML form is recognised as tokens and rebuilt by the renderer, so an author's attributes never reach the output. `render.test.ts` and `details.test.ts` hold the attack cases (event handlers, styles, markup in the summary, a script in the body) in place.

### The editor

A `details` node holds a `detailsSummary` line and a body of blocks, whatever syntax it was read in, with the syntax and its spelling carried as attributes. Its view draws it with the reader's frame:

- The summary and the body are edited in place.
- The **chevron** opens and closes the details while writing. That changes nothing in the document and is not a step of undo, and the details opens by itself when the caret goes into its body.
- **Open by default** sets the document's `open`; it is a change, and one step of undo.
- Enter in the summary goes into the body, taking the words after the caret. Backspace at the start of the summary, or in a body holding only an empty line, takes the details away and keeps its words; at the start of a body with something in it the caret goes back to the summary. Enter on an empty last line leaves the details.
- **Slash items** "Details" (found by "expand", Confluence's name, and "toggle", Notion's) and "Accordion", through the slash registry; **`+++` and a space** on an empty line makes one.
- Pasted GitHub HTML, as Markdown text or as rendered HTML, becomes a details.

`RENDER_VERSION` is 9.

## Alternatives considered

- **A `div` and a button.** It needs script to work at all, re-implements keyboard and announcement behaviour the browser has, and find cannot reach into it.
- **Allowing `details` and `summary` as raw HTML through the sanitiser.** Simpler, but it would make raw HTML a parsed surface with its own allowlist to keep right, which ADR-011 deliberately avoids; recognising the exact shape and rebuilding it keeps authors' attributes out entirely.
- **`:::callout{fold}` for foldable callouts.** It would be a second syntax for the same thing; a details with a kind says it once.
- **Remembering which sections a reader opened.** State that outlives the page surprises a reader who shares a link, and a details' default is the author's to set.

## Consequences

- READMEs and documentation written for GitHub, Docusaurus, Starlight and Obsidian show their collapsible sections in Quill without being rewritten, and still read as they did everywhere else.
- A document that held `<details>` changes how it renders, so `RENDER_VERSION` moves to 9 and bodies render again on next read (ADR-031).
- The public reader script grows by the enhancer, about 1 KiB gzipped.
