import type { RootContent } from 'mdast'

import { writeFrontMatter } from '../front-matter/yaml-document.ts'
import type { Warning } from '../warnings.ts'
import type { SerialisableDocument } from './parse-document.ts'
import { frontMatterNode } from './parse-document.ts'
import { stringifyMdast } from './processor.ts'
import { replaceUnserialisable } from './serialisable.ts'

/**
 * Writes a document back to Markdown. Deterministic and idempotent (ADR-002):
 * serialising an unchanged document produces the bytes it came from, and
 * serialising the result again changes nothing.
 *
 * Front matter is re-emitted from the record, so a field this version of the
 * platform does not know keeps its value, its place in the file, and the comments
 * around it.
 */
export function serializeDocument(document: SerialisableDocument): string {
  return serializeDocumentWithWarnings(document).markdown
}

export interface SerialisedDocument {
  readonly markdown: string
  /** One per node the serialiser had to degrade; empty for any normal document. */
  readonly warnings: readonly Warning[]
}

/**
 * The same write, with what it had to degrade on the way.
 *
 * Serialising is total (AGENTS.md rule 7), which means it can quietly reduce a
 * node nothing models to its text. A caller publishing a document deserves to
 * hear that, the same way `stripAuthoringBlocks` reports its placeholders, so
 * the warnings are returned rather than dropped on the floor. `serializeDocument`
 * stays exactly as it was for every caller that only wants the Markdown.
 */
export function serializeDocumentWithWarnings(document: SerialisableDocument): SerialisedDocument {
  const existing = frontMatterNode(document.ast)
  const yaml = writeFrontMatter(document.frontMatter, existing?.value)
  const body = document.ast.children.filter((child) => child.type !== 'yaml')
  const children: RootContent[] =
    yaml === undefined ? body : [{ type: 'yaml', value: yaml }, ...body]
  const { tree, warnings } = replaceUnserialisable({ ...document.ast, children })
  return { markdown: stringifyMdast(tree), warnings }
}
