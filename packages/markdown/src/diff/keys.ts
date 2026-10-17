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

/**
 * A node's identity as the words and structure it has, leaving out where its links and
 * pictures point, the order its fields were written in, and fields that say nothing
 * (`null`). A draft is built by the editor and a published page is read back from
 * Markdown, so the same block arrives with its fields in another order, a link written in
 * another form (the publish writes it canonically) and a `null` where there is no field;
 * this is what tells them to be one block. Not for comparing versions of a document, where
 * a link that moved is a change: `nodeKey` is.
 */
export function shapeKey(node: Node): string {
  return JSON.stringify(node, (name, value: unknown) => {
    if (name === 'position' || name === 'data' || name === 'url' || value === null) return undefined
    if (typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.entries(value).toSorted(([first], [second]) => first.localeCompare(second)),
    )
  })
}
