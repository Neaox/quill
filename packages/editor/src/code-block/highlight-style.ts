import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'
import type { Tag } from '@lezer/highlight'
import type { TokenClass } from '@quill/highlight'

/**
 * The editor's syntax colours, which are the reading surface's syntax colours.
 *
 * ADR-030 makes the CSS variables the consistency contract, not the tokenizer:
 * Lezer colours a block while it is being written and Prism colours it once it is
 * published, and the two draw token boundaries slightly differently, but both
 * resolve to the same `--token-<class>` variable, so a block looks the same in
 * both places. The class names below are the token classes of the highlight
 * package, which owns that list; this module consumes them and adds none of its
 * own.
 *
 * Colour only, in both presentations: `::highlight()` can paint nothing else, so
 * nothing here is allowed to either.
 */

/** Which Lezer tags mean which themed class. */
export const TAG_TOKEN_CLASSES: ReadonlyArray<readonly [readonly Tag[], TokenClass]> = [
  [[t.punctuation, t.separator, t.bracket, t.paren, t.brace, t.squareBracket], 'punctuation'],
  [[t.comment, t.lineComment, t.blockComment, t.docComment], 'comment'],
  [
    [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword, t.self],
    'keyword',
  ],
  [
    [
      t.operator,
      t.derefOperator,
      t.arithmeticOperator,
      t.logicOperator,
      t.compareOperator,
      t.updateOperator,
    ],
    'operator',
  ],
  [[t.bool], 'boolean'],
  [[t.null], 'null'],
  [[t.number, t.integer, t.float], 'number'],
  [[t.string, t.character, t.docString], 'string'],
  [[t.special(t.string), t.escape], 'template-string'],
  [[t.function(t.variableName), t.function(t.propertyName), t.macroName], 'function'],
  [[t.className, t.typeName, t.namespace], 'class-name'],
  [[t.propertyName], 'property'],
  [[t.attributeName], 'attr-name'],
  [[t.attributeValue], 'attr-value'],
  [[t.tagName, t.angleBracket], 'tag'],
  [[t.regexp], 'regex'],
  [[t.meta, t.annotation, t.processingInstruction], 'important'],
  [[t.variableName], 'variable'],
  [[t.atom, t.constant(t.variableName)], 'constant'],
  [[t.labelName], 'symbol'],
  [[t.standard(t.name)], 'builtin'],
  [[t.deleted], 'deleted'],
  [[t.inserted], 'inserted'],
  [[t.url, t.link], 'url'],
  [[t.heading], 'title'],
  [[t.strong], 'bold'],
  [[t.emphasis], 'italic'],
]

/**
 * The themed classes no Lezer tag is mapped onto, reviewed one by one.
 *
 * ADR-030 makes the `--token-*` variables the consistency contract, not the
 * tokenizer, and the two tokenizers do not draw the same boundaries: Prism
 * names some constructs Lezer only ever describes by their parts. Each entry
 * below says which parts carry the colour instead, so a class that stops being
 * coloured for any other reason fails `highlight-style.test.ts` rather than
 * quietly rendering a construct plain while it is being written.
 *
 * This is an allowlist, not a filter: adding a token class to
 * `packages/highlight` fails the build until it is either mapped above or
 * reviewed into this list.
 */
export const UNMAPPED_TOKEN_CLASSES: readonly TokenClass[] = [
  // Lezer has no tag for the hole in a template literal: the expression inside
  // it is tagged as whatever it is — a variable, a call, a number — and each of
  // those is mapped above, so the hole's contents are coloured by their parts.
  'interpolation',
  // The CSS grammar tags a selector by its parts (`tagName`, `className`,
  // `labelName` for an id), all mapped above; there is no tag for the selector
  // as a whole to colour.
  'selector',
]

export function tokenVariable(tokenClass: TokenClass): string {
  return `var(--token-${tokenClass})`
}

export const tokenHighlightStyle: HighlightStyle = HighlightStyle.define(
  TAG_TOKEN_CLASSES.map(([tags, tokenClass]) => ({ tag: tags, color: tokenVariable(tokenClass) })),
)

export const tokenHighlighting: Extension = syntaxHighlighting(tokenHighlightStyle)
