import { BRAND } from '@quill/brand'

import type { DirectiveKind } from '../directives/definition.ts'
import { KNOWN_DIRECTIVES } from '../directives/registry.ts'
import type { AnyBlock } from './define.ts'
import { blockKind, blockProblems, itemsOf } from './define.ts'
import { endpointBlock } from './endpoint.ts'

/**
 * The component blocks an instance draws (ADR-060), by name.
 *
 * Part of the Markdown registry (`extensions/registry.ts`), built once at
 * the composition root. It refuses, at construction, a block that breaks
 * the contract, one whose name another block or one of Quill's own
 * directives already has, and an `items` block that is not registered, so a
 * mistake stops the process at boot rather than one document at a time.
 */
export interface BlockRegistry {
  readonly blocks: readonly AnyBlock[]
  /** The block a directive of this name and form is, if any. */
  find(name: string, kind: DirectiveKind): AnyBlock | undefined
  /** The block with this name in any form: to say "write it as a container". */
  named(name: string): AnyBlock | undefined
  /** Every data attribute a registered block may emit: the sanitiser's grant. */
  readonly dataAttributes: readonly string[]
}

/** The blocks Quill ships. */
export const BUILT_IN_BLOCKS: readonly AnyBlock[] = [endpointBlock]

/** Names Quill's own directives already mean: no block may claim one. */
const RESERVED: ReadonlySet<string> = new Set(KNOWN_DIRECTIVES.flatMap((known) => known.names))

export function createBlockRegistry(blocks: readonly AnyBlock[] = BUILT_IN_BLOCKS): BlockRegistry {
  const byName = new Map<string, AnyBlock>()
  const ids = new Set<string>()
  for (const block of blocks) {
    const problems = [
      ...blockProblems(block),
      ...(RESERVED.has(block.name)
        ? [`"${block.name}" is one of ${BRAND.name}'s own directives`]
        : []),
      ...(byName.has(block.name) ? [`another block is already called "${block.name}"`] : []),
      ...(ids.has(block.id) ? [`another block already has the id "${block.id}"`] : []),
    ]
    if (problems.length > 0) {
      throw new Error(`The block "${block.id}" cannot be installed: ${problems.join('; ')}.`)
    }
    byName.set(block.name, block)
    ids.add(block.id)
  }
  for (const block of blocks) {
    const items = itemsOf(block)
    if (items === undefined) continue
    const item = byName.get(items)
    if (item === undefined || blockKind(item) !== 'container') {
      throw new Error(
        `The block "${block.id}" cannot be installed: its items "${items}" are not a container block that is installed.`,
      )
    }
  }

  return {
    blocks,
    find: (name, kind) => {
      const block = byName.get(name)
      return block !== undefined && blockKind(block) === kind ? block : undefined
    },
    named: (name) => byName.get(name),
    dataAttributes: [...new Set(blocks.flatMap((block) => block.data ?? []))].toSorted(),
  }
}

/** The built-in blocks' registry, for a render given no registry of its own. */
export const BUILT_IN_BLOCK_REGISTRY: BlockRegistry = createBlockRegistry()

/** Whether a directive name is one of Quill's own, which no block may claim. */
export function isQuillDirective(name: string): boolean {
  return RESERVED.has(name)
}
