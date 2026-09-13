import type { Processor } from 'unified'

import type { ToMarkdownExtension } from './raw-mdast.ts'
import { rawMdastToMarkdown } from './raw-mdast.ts'

/**
 * `remark-stringify` escapes a literal `::` in prose as `\::`. The backslash
 * consumes the first colon and the remaining `:name` re-parses as a *text
 * directive* the author never wrote, so the escape is round-trip unsafe rather
 * than merely cosmetic (research R3 finding 4(b)). Escaping both colons fixes it;
 * the cost is that a literal `::` is written `\:\:`.
 */
/**
 * What a directive name may start with, as a character class.
 *
 * `micromark-extension-directive`'s `factoryName` accepts any character that is
 * not whitespace and not punctuation — letters, digits, and everything above
 * ASCII. `mdast-util-directive`'s own escape covers `[A-Za-z]` only, so a text
 * node holding `3:2::` was written back as `3:2\:\:` and re-read with `:2` as a
 * directive: the same prose, a different tree. This is the complete class,
 * spelled as "not ASCII punctuation and not whitespace" because the patterns are
 * compiled without the `u` flag and cannot use a Unicode property escape. It is
 * marginally eager beyond ASCII — a colon before an em dash is escaped although
 * no name could start there — and an unnecessary backslash is inert.
 */
const DIRECTIVE_NAME_START = String.raw`[^\s!-/:-@\[-` + '`' + String.raw`{-~]`

export const DIRECTIVE_COLON_ESCAPE: ToMarkdownExtension = {
  unsafe: [
    { character: ':', after: ':' },
    { character: ':', before: ':' },
    // The last colon of an odd-length run. `mdast-util-to-markdown` runs each
    // pattern as its own non-overlapping pass, so in `a:::b` the first two rules
    // between them cover the first two colons and leave the third — which then
    // re-parses as the text directive `:b`, quietly turning prose into a
    // directive and losing a colon of the author's prose.
    { character: ':', before: ':', after: DIRECTIVE_NAME_START },
    // A colon that would start a directive whose name `mdast-util-directive`'s
    // own narrower escape misses: `:2`, `:9front`, `:日本語`.
    { before: '[^:]', character: ':', after: DIRECTIVE_NAME_START, inConstruct: ['phrasing'] },
  ],
}

/**
 * A byte-order mark inside a document's text, written as a character reference.
 *
 * Parsing drops a leading one (`processor.ts`), which is right for a file that
 * was saved with one and wrong for a document whose own first character happens
 * to be U+FEFF: writing it back verbatim puts it in the leading position, and
 * the next parse silently eats it. `mdast-util-to-markdown` encodes an unsafe
 * character it cannot backslash-escape as `&#xfeff;`, which survives both.
 */
export const BYTE_ORDER_MARK_ESCAPE: ToMarkdownExtension = {
  unsafe: [{ character: '﻿' }],
}

/**
 * Registers this package's `toMarkdown` extensions.
 *
 * `remark-stringify` discards an `extensions` option — it overwrites it with the
 * processor's `toMarkdownExtensions` — so the extensions have to be pushed onto
 * that list by a plugin.
 */
export function remarkToMarkdownExtensions(this: Processor): undefined {
  const data = this.data()
  const extensions = data.toMarkdownExtensions ?? []
  extensions.push(DIRECTIVE_COLON_ESCAPE, BYTE_ORDER_MARK_ESCAPE, rawMdastToMarkdown)
  data.toMarkdownExtensions = extensions
}
