import type { ExtractedText } from '../ports/document-format.ts'

/**
 * The description a crawler, a chat client's unfurl and a link card show: the
 * document's first paragraph (use case 29, ADR-042).
 *
 * The extracted text is the prose of the document, one block per line, with
 * authoring scaffolding and presenter notes already gone (ADR-031), so the
 * first line is the first paragraph. It is trimmed to a length that survives a
 * search result and an unfurl, cut at a word rather than mid-word, with an
 * ellipsis so a reader can see it was cut.
 */
export const DESCRIPTION_MAX_LENGTH = 200

/**
 * A link to another document whose words are its own address (`/d/<id>`, what
 * the slash menu's "Link to document" writes): the page draws it as the
 * document's live title for each reader, but in plain text it is the id. A
 * description is shown to strangers (a crawler, an unfurl, a card on a public
 * page), and the id names a page they may never have been shown (ADR-046), so
 * it is said in words instead.
 */
const DOCUMENT_ADDRESS = /(?<=^|\s)(?:\/w\/[^\s/]+)?\/d\/[\p{Letter}\p{Number}%_-]+(?:[#?]\S*)?/gu
const DOCUMENT_WORDS = 'a linked document'

export function firstParagraph(text: ExtractedText): string | null {
  const paragraph = text.body
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.replaceAll(DOCUMENT_ADDRESS, DOCUMENT_WORDS)
    .trim()
  if (paragraph === undefined || paragraph.length === 0) return null
  if (paragraph.length <= DESCRIPTION_MAX_LENGTH) return paragraph
  const cut = paragraph.slice(0, DESCRIPTION_MAX_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
