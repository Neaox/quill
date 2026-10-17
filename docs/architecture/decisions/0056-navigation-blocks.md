# ADR-056: Navigation blocks

**Status:** Accepted
**Date:** 2026-10-17
**Related:** ADR-002 (Markdown is canonical), ADR-012 (permissions), ADR-023 (public site), ADR-031 (render caching), ADR-032 (live blocks), ADR-033 (compatibility), ADR-036 (diagrams and reading blocks), ADR-039 (Markdown extensions), ADR-044 (deep links), ADR-046 (dead links), ADR-048 (details and accordions), [connectors idea](../../ideas/work-tracker-and-code-host-connectors.md)

## Context

The owner asked for a table of contents block, a child-documents block with a control over how many levels deep it goes, and a table of contents with a control over which heading levels it shows. They also asked which of Confluence's most used blocks Quill should have.

Confluence calls its blocks *macros*. Atlassian's macro index lists them alphabetically and publishes no usage figures, so the ranking below is a judgement. It is based on which macros Atlassian's own templates and space blueprints insert, which ones teams moving off Confluence ask importers to carry, and which have a direct counterpart on the documentation platforms Quill is measured against. Every Confluence macro the owner named is covered.

### Confluence's macros, and where Quill stands

| Confluence macro | What it does | Quill | How |
| --- | --- | --- | --- |
| **Table of contents** | The page's headings as links | **Has it (this ADR)** | `::toc` |
| **Children display** | The pages under this one | **Has it (this ADR)** | `::children` |
| **Page tree** | An expandable tree of a space or a branch | **Has it in substance** | The sidebar is the tree. `::children{depth=…}` covers the in-page use. A collapsible in-page tree waits until someone asks for it |
| **Info, Note, Tip, Warning panels** | Coloured asides | **Has it** | Callouts and GitHub alerts (ADR-036) |
| **Expand** | A collapsible section | **Has it** | Details and accordions (ADR-048) |
| **Code block** | Highlighted code | **Has it** | Fenced code, cards, groups (ADR-030, ADR-041) |
| **Status** (lozenge) | A coloured word | **Has it** | Badges and labels (ADR-036, ADR-037) |
| **Layouts and columns** | Multi-column sections | **Has it, partly** | Breakout widths and cards (ADR-027, ADR-036). Arbitrary column grids are deliberately not offered: they fall apart on a phone and in Markdown |
| **Anchor** | A named link target | **Has it** | Heading permalinks and aliases, block anchors (ADR-044) |
| **Attachments** | A list of the page's files | **Has it, in the app** | The attachments panel. A `::attachments` block is low value: a reader wants the file a sentence links to, not an inventory |
| **Date** | An inline date | **Will have** | `:date[2026-10-17]`, rendered as `<time>`. Small, and a natural pair with review dates |
| **Mention** | A person, notified | **Will have, with comments (M4)** | `:mention[Chris]{id=…}`. Needs people search and notifications, which arrive with comments |
| **Excerpt** and **Excerpt include** | Mark part of a page, show it elsewhere | **Will have (next)** | `:::excerpt` and `::include{doc=… part=excerpt}` (Delivery) |
| **Include page** | Transclude a whole page | **Will have (next)** | `::include{doc=…}` (Delivery) |
| **Content by label** | Pages with a label | **Will have (next)** | `::documents{tag=…}`, already ADR-032's example of a live block |
| **Recently updated** | Recent changes in a space | **Will have (next)** | `::documents{sort=updated limit=10}`: the same block, sorted |
| **Page properties** and **Page properties report** | Key–value table on each page, and a report of them across pages | **Will have** | Front matter *is* page properties. The report is `::documents{… columns=owner,status,review}` |
| **Task report** | Open tasks across pages | **Will have, later** | Needs task ownership and due dates in the task-list syntax first |
| **Decision log** | A report of decision pages | **Has it in substance** | A Decisions collection plus `::documents{type=decision columns=status}`. No separate macro |
| **Jira issues** | Live issue lists from Jira | **Will have, through connectors** | A live block from a connector (the connectors idea, ADR-032) |
| **Roadmap planner** and **Timeline** | Drawn roadmaps | **Won't** | A roadmap is a diagram (Mermaid's `gantt` and `timeline`, ADR-036) or belongs in the work tracker. A bespoke drawing surface is a product of its own |
| **Recently updated dashboard**, **Popular**, **Contributors** | Activity widgets | **Won't, as blocks** | Activity belongs in the app's home and the document's history, not in a document's source |
| **HTML**, **iframe**, **user macros** | Arbitrary markup | **Won't** | ADR-011 and ADR-032: no author-supplied markup or code. Packaged extensions (ADR-039) are the way to add a block |

## Decision

Two blocks, both leaf directives (ADR-002, ADR-039), both in `packages/markdown` until the packaged tier exists.

### `::toc`: a table of contents

```markdown
::toc
::toc[On this page]{levels=2-4 style=numbered collapsed}
```

- **`levels`**: the heading levels listed, `N` or `N-M`, from 1 to 6. The default is `2-3`: the document's own title (`h1`) is not a section of it, and three levels deep is already a long list. A value that is not a level range falls back to the default and is reported as a warning, never an error (directives degrade).
- **The label** is an optional title, shown above the list and naming it.
- **`style`**: `bulleted` (the default) or `numbered`. Numbered lists use `<ol>` and are numbered `1`, `1.1`, `1.2` by the stylesheet's counters.
- **`collapsed`**: a section with subsections shows its own link and a disclosure for the rest, closed. Without it every level is open. The disclosure is the browser's own `<details>`, beside the link rather than around it, so the link is never inside the control (axe's `nested-interactive`), and it works without script.

**It is part of the body.** Its entries come from the document's own headings, so it is a pure function of the source and is cached with the body like everything else (ADR-031); no slot, no request. The renderer takes the outline from the same tree and the same slugger as the headings (`extractOutline`), so every link uses the id the heading's own permalink uses, and when a heading changes, the next render changes the entry. An alias (ADR-044) is an *extra* target for old links; the contents points at the heading's current id, which is the one that stays correct.

**Markup.** A `nav` named by its title, or "Table of contents" when it has none, and a nested list:

```html
<nav class="toc" data-style="numbered" aria-labelledby="toc.1">
  <p class="toc-title" id="toc.1">On this page</p>
  <ol class="toc-list">
    <li><a href="#user-content-install">Install</a>
      <ol class="toc-list">…</ol>
    </li>
  </ol>
</nav>
```

A document with no headings at those levels shows one quiet line saying so, rather than nothing: an empty render would hide a block the author placed.

**The reader marks the section being read** in every table of contents on the page, with the same `IntersectionObserver` module the public site's "On this page" rail uses (`@quill/design-css`'s contents spy), so the two can never disagree about where the reader is.

**Outside Quill**, `::toc{levels=2-3}` reads as a line of text. That is honest and short, and GitHub already draws its own outline menu for every Markdown file, so nothing is lost there. GitLab's `[[_TOC_]]` and the `[TOC]` of Python-Markdown and many wikis become `::toc` in the M4 importer.

### `::children`: the pages under this one

```markdown
::children
::children[In this section]{depth=2 sort=title excerpts icons}
```

- **`depth`**: how many levels of descendants, 1 to 6, default 1.
- **`sort`**: `manual` (the default: the order the navigation tree shows), `title`, or `updated` (most recently changed first). Until manual reordering lands, the navigation's order is the order pages were created in; `manual` will follow manual reordering when it ships, without a document changing.
- **`excerpts`**: each page's summary under its title: its `description`, or else its first paragraph, cut to a sentence or two.
- **`icons`**: each page's own icon (the `icon` in its front matter, an emoji) or a page glyph.
- **The label** is an optional title.

**It is a slot (ADR-032).** The list depends on *other* documents and on *who is reading*, so it cannot be part of the cached body. The body renders a `section` carrying the block's type and a key derived from its parameters, `children?depth=2&sort=title&excerpts&icons`, with a readable fallback inside, and lists the key in the rendered content's `slots`. The page fills it as it is assembled:

- **In the app,** `GET /api/documents/:id/children?depth=&sort=&excerpts=&icons=` answers the list for this reader as the same template's HTML, and the reading view puts it in the slot.
- **On the public site,** the page fills the slot from the site it has already loaded, with the site's own addresses, before the page is cached. Only published, public pages are on a site, so only they are listed.

**Permissions.** A child the reader cannot read is never listed, and its subtree is not reached through it. Visibility is the same materialise-and-combine pass the navigation tree and the public site use (ADR-012), over one collection, because a document's children are always in its collection. When the materialised effective-permission table lands (quill-plan.md section 15), this pass becomes a join and nothing above it changes.

**Cost.** One query for the subtree, a recursive query bounded by the depth, and one for the summaries, however many pages there are; never one per page. The subtree's structure is cached in the process, keyed by the parent and the options, and invalidated by the outbox's `DocumentCreated`, `DocumentPublished`, `DocumentRenamed`, `DocumentMoved`, `DocumentNested` and `DocumentDeleted` events for anything in or under it. Permissions are never cached here: they are answered per request, so a new deny takes effect at once.

**The empty state** says "No child pages yet". In the app, someone who can edit the page is also offered "Create a child page", which opens the New document dialog with this page as the parent.

**Markup.** A list of links, nested to the depth asked for:

```html
<section class="live-block child-pages" data-live-block="children" data-live-key="children?depth=1&amp;sort=manual" aria-label="Child pages">
  <ul class="child-pages-list">
    <li><a href="/w/engineering/d/regional-failover-8kgqjvd4mr">Regional failover</a><p class="child-page-excerpt">…</p></li>
  </ul>
</section>
```

One template (`renderChildPages` in `packages/markdown`) draws it for the app, the public site and export (AGENTS.md rule 16); each passes its own addresses.

**Outside Quill**, `::children` reads as a line of text, as `::toc` does. Inside a Quill that cannot fill the slot (an export without a server, a share link), the fallback says what would be there.

### The editor

Both are leaf directives, so they round-trip through the existing node byte for byte. Each gets a node view that shows a live preview, and a **Settings** button opening a popover:

- **Table of contents:** title, from and to levels, numbered or bulleted, collapsed. The preview is drawn from the document being edited, through the same ids the reader will use, and updates as headings are typed. It is recomputed only when a document holding a table of contents changes.
- **Child pages:** title, depth, sort, excerpts, icons. The preview asks the application for the current list; an editor without that shows what will be listed in words.

Every change in the popover is one transaction, so one undo takes it back. The slash menu offers both in a **Navigation** group of their own, after References ("Table of contents", aliases `toc` and `contents`; "Child pages", aliases `children` and `subpages`), contributed through the registry.

## Alternatives considered

- **Rendering the children list into the cached body.** Rejected: the body would then depend on other documents and on the reader, which breaks ADR-031 and would show one reader's private pages to another.
- **A client-only children list.** Rejected: the public site has no application, and crawlers and exports would get nothing.
- **Folding table-of-contents sections with the link inside `<summary>`.** Rejected: a link inside a disclosure control is two controls in one, which screen readers announce badly and axe fails.
- **One `::contents{of=headings|children}` block.** Rejected: the two have nothing in common but the word, one is static and one is a slot, and Confluence's own names (table of contents, children) are what people search the slash menu for.
- **GitLab's `[[_TOC_]]` as the syntax.** Rejected: it reads as a broken wiki link everywhere else, and it is not a directive, so it would need syntax of its own (ADR-039).

## Consequences

- `RENDER_VERSION` is bumped, because `::toc` and `::children` now render differently from the live-block fallback they rendered as before.
- The search projection carries each page's summary and icon (a nullable column each), so the children list never reads the content store. Pages indexed before this read their excerpt from the first line of their indexed body until they are republished or reindexed.
- Two new outbox events, `DocumentNested` (a document re-parented within its collection) and `DocumentDeleted`, close gaps that also mattered elsewhere: nothing announced either before.

## Delivery

1. This ADR; `::toc` and `::children` in the renderer, sanitiser grant, corpus and editor; the children query, its cache and its events; the contents spy shared with the rail; specimens and the reading tour. **(Done, 17 October 2026.)**
2. **Excerpt and include**, the next most asked for: `:::excerpt` marks the part of a page that stands for it (and becomes the page's summary when present), and `::include{doc=<id>}` or `::include{doc=<id> part=excerpt}` shows another page, or its excerpt, in place. A slot, permission-checked per reader, with the source page's title as its caption and a link to it; an include of an include is drawn one level deep only.
3. **Document lists**: `::documents{tag=runbook sort=updated limit=10}` is Content by label and Recently updated; `columns=owner,status,review` makes it the Page properties report, reading front matter, which is where Quill's page properties already live. `type=decision` makes it the decision log. A slot, invalidated by the same events as `::children`.
4. **Date** (`:date[…]`) and **mention** (`:mention[…]{id=…}`), the latter with comments in M4.
5. **Task report**, once task items carry an owner and a due date.
6. **Jira and other trackers**, as live blocks from the connectors (ADR-032).
