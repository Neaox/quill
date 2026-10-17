import type { Node } from 'mdast'

/**
 * A node's identity for comparison: everything it says, and nothing about
 * where it was written. Two blocks with the same key read the same, which is
 * what block matching (ADR-021's amendment: "by content hash and position")
 * and inline atoms both compare by.
 *
 * The key is the serialised node rather than a digest of it: the comparison
 * interns keys to integers once (`sequence.ts`), so a digest would add a hash
 * per block and save nothing, and a key can be read when a test fails.
 */
export function nodeKey(node: Node): string {
  return JSON.stringify(node, (name, value: unknown) =>
    name === 'position' || name === 'data' ? undefined : value,
  )
}
