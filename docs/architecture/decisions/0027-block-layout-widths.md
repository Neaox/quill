# ADR-027: Block layout widths (breakout blocks)

**Status:** Accepted; syntax confirmed in R2, editor affordance in R3, grid in R13
**Date:** 2026-09-12
**Related:** quill-plan.md sections 16, 17, and 29; ADR-002, ADR-003

## Context

Prose reads best in a narrow measure, but tables, wide images, diagrams, and code often need more room. Confluence lets a table or the whole page expand beyond the text column. Quill needs the same, for any block, in a way that is reliable, responsive, and still plain Markdown.

## Decision

### Three widths

Every block has a layout width: **content** (the reading measure, the default), **wide** (up to a larger fixed width), or **full** (the entire main region). A document may set a default width for all its blocks in front matter (`layout: wide` or `layout: full`), which is the Confluence "page width" behaviour.

### Markdown representation

Width is expressed by wrapping blocks in a container directive:

```text
:::wide
| Region | Endpoint | Latency budget | Owner |
| ------ | -------- | -------------- | ----- |
| ...    | ...      | ...            | ...   |
:::

:::full
![System landscape](landscape.svg)
:::
```

The directive may wrap one block or several. Outside Quill, a renderer that ignores directives shows the inner content unchanged, which satisfies the degradation rule of ADR-002. Tables, images, and code blocks keep their standard Markdown syntax; the wrapper is the only addition. No attributes on images or tables are used, so there is one mechanism to learn and to round-trip.

### Layout mechanism

The reading and editing surfaces share one CSS grid with named lines:

```text
[full-start] gutter [wide-start] 1fr [content-start] measure [content-end] 1fr [wide-end] gutter [full-end]
```

- A block spans `content`, `wide`, or `full` lines according to its width.
- The table of contents and navigation sidebars are columns of the page shell outside this grid, so a full-width block never collides with them.
- Breakpoints: below the medium breakpoint the three widths collapse to the viewport width with a gutter, so nothing is clipped on phones. Between medium and large, `wide` and `full` are both the main region. At large and above, all three are distinct.
- Tables are always scrollable horizontally inside their width. `wide` and `full` give columns room before scrolling is needed.
- Images and diagrams never upscale beyond their intrinsic width; `full` sets the maximum, not a stretch.
- Print uses the page width for every block. PDF export follows the same rule. HTML export includes the grid stylesheet.

### Editor

In the editor a block's width is a property in its block menu (content, wide, full), which wraps or unwraps the directive. The wrapper is not shown as a separate block; the author sees the table or image at its chosen width, exactly as a reader will.

## Alternatives considered

- **Attributes on individual elements** (`![alt](src){width=full}` or table attributes). Rejected: Markdown tables cannot carry attributes without non-standard syntax, and a second mechanism would be needed for multi-block groups.
- **Per-document width only** (Confluence's older model). Rejected as the only option: it forces the whole page wide for one table.
- **Negative margins on specific elements.** Rejected: brittle with sidebars and breakpoints; the named-line grid is the reliable pattern.
- **Letting blocks overlap the table of contents.** Rejected: unreadable and inaccessible.

## Consequences

- `packages/markdown` gains a `layout` container directive with `wide` and `full` names, parsed and serialised like any other directive.
- The reading grid is a design-system primitive (R13) used by the SPA, server rendering, and HTML export alike.
- The editor's block menu (R3) exposes width as a first-class property.
- Front matter core schema (ADR-005) gains an optional `layout` field.
