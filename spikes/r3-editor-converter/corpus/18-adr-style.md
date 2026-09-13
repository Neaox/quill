# ADR-099: Example decision record

Source: written for this spike, in the shape of the ADRs in `docs/architecture/decisions`.

**Status:** Proposed
**Date:** 2026-09-12
**Related:** quill-plan.md section 17; ADR-002, ADR-004

## Context

Prose reads best in a narrow measure, but tables, wide images, diagrams, and code
often need more room. The editor and the reader must agree on how that is
expressed, and the expression must survive a round trip through Markdown.

## Decision

- Width is one of **content**, **wide**, or **full**.
- Width is expressed by wrapping blocks in a container directive.
- A document may set a default in front matter.

### Markdown representation

```text
:::wide
| Region | Endpoint |
| ------ | -------- |
| eu     | ...      |
:::
```

## Alternatives considered

| Alternative | Why it was rejected |
| ----------- | ------------------- |
| Attributes on individual elements | GFM tables cannot carry attributes |
| Per-document width only | Forces the whole page wide for one table |
| Negative margins | Brittle with sidebars and breakpoints |

## Consequences

1. `packages/markdown` gains a `layout` container directive.
2. The reading grid becomes a design-system primitive.
3. The editor's block menu exposes width as a first-class property.

## Notes

*This record is an example used by the R3 spike corpus; it decides nothing.*
