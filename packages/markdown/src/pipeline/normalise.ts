const LINE_ENDINGS = /\r\n?/g
const BYTE_ORDER_MARK = '﻿'

/**
 * The two formatting-only normalisations a document goes through before it is
 * parsed at all, so nothing downstream has to think about either.
 *
 * **Line endings become `\n`.** A `\r` survives micromark into a code block's
 * value and into prose, and from there into the rendered HTML — where a
 * browser's parser drops it again while building the text node. Every offset
 * the server computed over that text (the packed token ranges of ADR-030 above
 * all) would then point one character further along on every line after the
 * first, so a CRLF document's code blocks were highlighted in the wrong places.
 * Normalising once here is what makes an offset mean the same thing on both
 * sides. It also keeps serialisation deterministic: a tree carrying `\r\n`
 * inside one node and `\n` in the next writes a file with mixed line endings.
 *
 * **A leading byte-order mark is dropped.** remark discards it anyway; doing it
 * here is what lets the fidelity documentation state it as a known change.
 *
 * Both are formatting-only, and the README's fidelity levels list them with the
 * other normalisations a document meets the first time it is opened.
 */
export function normaliseMarkdown(markdown: string): string {
  const withoutMark = markdown.startsWith(BYTE_ORDER_MARK) ? markdown.slice(1) : markdown
  return withoutMark.replaceAll(LINE_ENDINGS, '\n')
}
