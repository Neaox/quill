/**
 * What a draft holds, in the words a person would use: how many sections it has and how many words
 * are written in them.
 *
 * Read for the page of a document that has never been published, which should say what is waiting
 * to be published rather than that nothing is there. The words are the writing: not the headings,
 * which are the sections, and not a template's guidance, which is help for the writer and is never
 * published. The tree is opaque to this layer (`draft-content.ts`), so it is read as structure.
 */

export interface DraftSummary {
  /** Headings below the title. */
  readonly sections: number
  readonly words: number
}

interface Node {
  readonly type?: unknown
  readonly depth?: unknown
  readonly name?: unknown
  readonly value?: unknown
  readonly children?: unknown
}

/** Template directives whose words are help for the writer, not part of what is published. */
const NOT_WRITING: ReadonlySet<string> = new Set(['guidance', 'placeholder'])

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null

function childrenOf(node: Node): readonly Node[] {
  return Array.isArray(node.children) ? node.children.filter(isNode) : []
}

function wordsIn(node: Node): number {
  if (node.type === 'heading') return 0
  if (typeof node.name === 'string' && NOT_WRITING.has(node.name)) return 0
  if (node.type === 'text' && typeof node.value === 'string') {
    return node.value.split(/\s+/u).filter((word) => word !== '').length
  }
  return childrenOf(node).reduce((total, child) => total + wordsIn(child), 0)
}

/** A draft's tree summarised, or undefined when it is not a document tree. */
export function summariseDraft(tree: unknown): DraftSummary | undefined {
  if (!isNode(tree) || tree.type !== 'root') return undefined
  const blocks = childrenOf(tree)
  return {
    sections: blocks.filter((block) => block.type === 'heading' && Number(block.depth) >= 2).length,
    words: blocks.reduce((total, block) => total + wordsIn(block), 0),
  }
}
