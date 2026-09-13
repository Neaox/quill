import type { Options as GfmOptions } from 'remark-gfm'
import type { Options as StringifyOptions } from 'remark-stringify'

/**
 * The canonical serialisation profile (ADR-002, research R3 section "Serialisation
 * profile"). It is part of the public contract of this package: changing any of
 * these re-flows every document in every repository the platform syncs with, so a change
 * needs an ADR amendment.
 */
export const SERIALISE_OPTIONS: StringifyOptions = {
  bullet: '-',
  bulletOrdered: '.',
  emphasis: '*',
  strong: '*',
  fence: '`',
  fences: true,
  rule: '-',
  ruleRepetition: 3,
  listItemIndent: 'one',
  incrementListMarker: true,
  tightDefinitions: true,
  setext: false,
  resourceLink: false,
}

/**
 * `tablePipeAlign` defaults to true, which pads every cell to its column width, so
 * editing one cell rewrites every row of the table in the Git diff. Measured on the
 * R3 corpus, padding doubles the lines a first publish touches (75 of 897 against
 * 38) and turns a one-cell edit from one changed line into four.
 */
export const GFM_OPTIONS: GfmOptions = { tablePipeAlign: false }
