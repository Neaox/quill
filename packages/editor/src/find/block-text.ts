import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * A line of text in a document, as one string, and where each of its characters is.
 *
 * Text is held in pieces, one for each run of one set of marks, with elements between them, so a
 * word that is half bold is two pieces of the document. Searching wants one string; selecting and
 * replacing want positions. This gives both, and `positionAt` says where a character really is.
 */

/** What stands in the string for an inline element that is not text, such as an image: one character no query means. */
export const ELEMENT = '\uFFFC'

export interface BlockText {
  readonly text: string
  /** The position in the document of the character at `offset` in `text`. */
  positionAt(offset: number): number
}

interface Piece {
  /** Where the piece begins in the string. */
  readonly start: number
  /** Where its first character is in the document. */
  readonly position: number
}

export function blockText(block: PMNode, blockPosition: number): BlockText {
  const inside = blockPosition + 1
  const pieces: Piece[] = []
  let text = ''
  block.descendants((node, position) => {
    if (!node.isText && !node.isLeaf) return true
    pieces.push({ start: text.length, position: inside + position })
    text += node.isText ? node.textContent : ELEMENT
    return false
  })
  return {
    text,
    positionAt(offset) {
      // The last piece that starts at or before the offset: the pieces are in order, and the first
      // starts at nought, so there is always one.
      const piece = pieces.reduce<Piece>(
        (found, candidate) => (candidate.start <= offset ? candidate : found),
        { start: 0, position: inside },
      )
      return piece.position + (offset - piece.start)
    },
  }
}
