import { isDeepEqual } from 'remeda'
import { parseDocument, stringify, parse as parseYaml } from 'yaml'

import type { Warning } from '../warnings.ts'
import { warning } from '../warnings.ts'

/** A parsed YAML mapping, plus anything that went wrong while reading it. */
export interface FrontMatterRead {
  readonly value: Record<string, unknown>
  readonly warnings: readonly Warning[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads the YAML body of a front matter block. Malformed YAML and a non-mapping
 * document both degrade to an empty record with a warning: metadata is never a
 * reason to refuse to open a document.
 */
export function readFrontMatter(source: string): FrontMatterRead {
  let parsed: unknown
  try {
    parsed = parseYaml(source)
  } catch (error) {
    return { value: {}, warnings: [warning('front-matter-parse', String(error))] }
  }
  if (parsed === null || parsed === undefined) return { value: {}, warnings: [] }
  if (!isRecord(parsed)) {
    return { value: {}, warnings: [warning('front-matter-not-a-mapping', typeof parsed)] }
  }
  return { value: parsed, warnings: [] }
}

/**
 * Renders front matter back to YAML.
 *
 * When the record still matches the source it came from, the source is returned
 * byte for byte: comments, key order, complex keys, and quoting style all survive
 * untouched (ADR-002). When it has changed, the edit is applied to the parsed YAML
 * document so that only the affected keys move and everything else keeps its place.
 * An empty record leaves the source alone: front matter that failed to parse is
 * never silently deleted (AGENTS.md rule 7). Removing front matter is done by
 * removing the node from the tree.
 */
export function writeFrontMatter(
  value: Record<string, unknown>,
  source: string | undefined,
): string | undefined {
  if (Object.keys(value).length === 0) return source
  if (source === undefined) return stringify(value).trimEnd()

  const existing = readFrontMatter(source)
  if (isDeepEqual(existing.value, value)) return source
  if (existing.warnings.length > 0) return stringify(value).trimEnd()

  const document = parseDocument(source)
  for (const key of Object.keys(existing.value)) {
    if (!Object.hasOwn(value, key)) document.delete(key)
  }
  for (const [key, next] of Object.entries(value)) {
    if (!isDeepEqual(existing.value[key], next)) document.set(key, next)
  }
  return String(document).trimEnd()
}
