/** The navigation blocks (ADR-049): a table of contents, and the pages under this one. */
export type {
  ChildPagesBlock,
  ChildPagesDepth,
  ChildPagesQuery,
  ChildPagesSort,
} from './children.ts'
export {
  CHILD_PAGES_BLOCK,
  CHILD_PAGES_DEPTHS,
  CHILD_PAGES_SORTS,
  CHILDREN_DIRECTIVE_NAME,
  childPagesAttributes,
  childPagesFrom,
  childPagesSlotKey,
  childPagesSlots,
  CHILD_PAGES_SLOT_KEY,
  childrenDirective,
  DEFAULT_CHILD_PAGES,
  DEFAULT_CHILD_PAGES_QUERY,
  isChildPagesSort,
  parseChildPagesDepth,
  parseChildPagesSlotKey,
} from './children.ts'
export type { ChildPage } from './render.ts'
export {
  CHILD_PAGES_FALLBACK,
  CHILD_PAGES_LABEL,
  childPagesFill,
  childPagesQueries,
  fillChildPagesSlots,
  NO_CHILD_PAGES,
  NAVIGATION_SANITIZE_GRANT,
  renderChildPages,
  renderTableOfContents,
  TABLE_OF_CONTENTS_LABEL,
} from './render.ts'
export type { HeadingLevel, LevelRange, TableOfContents, TocEntry, TocStyle } from './toc.ts'
export {
  DEFAULT_TABLE_OF_CONTENTS,
  formatLevels,
  HEADING_LEVELS,
  parseLevels,
  TOC_DIRECTIVE_NAME,
  TOC_STYLES,
  tableOfContentsAttributes,
  tableOfContentsEntries,
  tableOfContentsFrom,
  tocDirective,
} from './toc.ts'
export { documentIcon, documentSummary, SUMMARY_LIMIT } from './summary.ts'
