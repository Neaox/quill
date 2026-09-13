/**
 * A non-fatal observation made while parsing, converting, or publishing a
 * document. Nothing in this package throws on unexpected input (AGENTS.md rule
 * 7): it degrades and records why.
 */
export interface Warning {
  readonly code: WarningCode
  readonly detail: string
}

export type WarningCode =
  | 'front-matter-parse'
  | 'front-matter-not-a-mapping'
  | 'unserialisable-node'
  | 'unsupported-inline'
  | 'unsupported-block'
  | 'unknown-inline-node'
  | 'unknown-block-node'
  | 'table-cell-flattened'
  | 'placeholder-remains'
  | 'unresolved-condition'
  | 'unknown-question'

export function warning(code: WarningCode, detail: string): Warning {
  return { code, detail }
}
