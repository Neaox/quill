import type { Processor } from 'unified'

import { mathFromMarkdown, mathToMarkdown } from './mdast.ts'
import { mathSyntax } from './syntax.ts'

export type { BlockMath, InlineMath } from './mdast.ts'

/**
 * Math (ADR-064), as a remark plugin: its syntax to read, its tree nodes, and the way back to
 * Markdown. Registered with the processor before `remarkToMarkdownExtensions`, which takes the
 * writers registered so far and adds this package's own.
 */
export function remarkMath(this: Processor): undefined {
  const data = this.data()
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), mathSyntax]
  data.fromMarkdownExtensions = [...(data.fromMarkdownExtensions ?? []), mathFromMarkdown]
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), mathToMarkdown]
}
