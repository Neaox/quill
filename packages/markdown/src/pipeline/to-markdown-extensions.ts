import type { Handle, Handlers } from 'mdast-util-to-markdown'
import type { Processor } from 'unified'

import type { ToMarkdownExtension } from './raw-mdast.ts'
import { rawMdastToMarkdown } from './raw-mdast.ts'
import { sourceFormToMarkdown } from './source-form.ts'
import { codeGroupToMarkdown } from '../code-group/code-group.ts'
import { detailsToMarkdown } from '../details/write.ts'

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

/**
 * A name that, closed by a colon, is not a directive: `micromark-extension-
 * directive` refuses a text directive whose name is followed by `:`
 * (`afterName`). ASCII only, and ending in a letter or digit as a name must,
 * so the exemption below is never wider than the parser's own rule; a name it
 * does not cover is escaped, which is inert.
 */
const CLOSED_NAME = '[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?:'

/**
 * A colon that would open a directive when the text is read back: one before a
 * name, unless that name is closed by a colon which is itself left bare —
 * followed by neither a name nor another colon. That is what keeps `:smile:`,
 * `10:30:00` and `a:b:c` as they were written (ADR-038), while `:smile:c`,
 * whose closing colon opens `:c` and so has to be escaped, escapes both.
 */
const OPENS_DIRECTIVE = `(?!${CLOSED_NAME}(?!${DIRECTIVE_NAME_START}|:))${DIRECTIVE_NAME_START}`

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
    { before: '[^:]', character: ':', after: OPENS_DIRECTIVE, inConstruct: ['phrasing'] },
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

type Unsafe = NonNullable<ToMarkdownExtension['unsafe']>[number]
type TextHandler = NonNullable<NonNullable<ToMarkdownExtension['handlers']>['text']>
type State = Parameters<TextHandler>[2]

const WORD = /[A-Za-z0-9]/
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/

/** Whitespace, or no character at all: the edge of a line counts as whitespace. */
function isSpace(character: string): boolean {
  return character === '' || /\s/.test(character)
}

/**
 * Whether the character at `index` of `text` needs a backslash to stay text.
 * `text` is the text node's value with the characters written either side of
 * it, so a rule sees what a reader will see.
 */
type EscapeRule = (text: string, index: number) => boolean

interface Narrowing {
  readonly character: string
  /** The library's rule for the character that this narrowing takes the place of. */
  readonly replaces: (pattern: Unsafe) => boolean
  readonly escapes: EscapeRule
}

/** The library's own rule that escapes a character everywhere in prose. */
function isEverywhereInProse(pattern: Unsafe, character: string): boolean {
  const { inConstruct } = pattern
  return (
    pattern.character === character &&
    pattern.atBreak === undefined &&
    pattern.before === undefined &&
    pattern.after === undefined &&
    (inConstruct === 'phrasing' || (Array.isArray(inConstruct) && inConstruct.includes('phrasing')))
  )
}

/**
 * `~` can only strike text through as a closing run, and a run closes only when
 * it is right-flanking: not after whitespace, and after punctuation only when
 * whitespace or punctuation follows (GFM 6.5, CommonMark 6.2). Escaping every
 * tilde that could close leaves nothing an opener could pair with, so `~3.5%`
 * keeps its bare tilde. Anything not ASCII punctuation counts as a letter
 * before the tilde, and as punctuation after it, which escapes a little more
 * than it must and never less. A tilde beside another joins its run, so it is
 * always escaped: `x ~` written before a strikethrough would otherwise
 * lengthen the strikethrough's own run.
 */
const TILDE: Narrowing = {
  character: '~',
  replaces: (pattern) => isEverywhereInProse(pattern, '~'),
  escapes: (text, index) => {
    const before = text.charAt(index - 1)
    const after = text.charAt(index + 1)
    if (before === '~' || after === '~') return true
    return !isSpace(before) && (!ASCII_PUNCTUATION.test(before) || !WORD.test(after))
  },
}

/**
 * `_` between two letters or digits can neither open nor close emphasis
 * (CommonMark 6.2, rules 2 and 6), so `snake_case` keeps its underscores. One
 * at the edge of a word, or beside punctuation, is escaped as before.
 */
const UNDERSCORE: Narrowing = {
  character: '_',
  replaces: (pattern) => isEverywhereInProse(pattern, '_'),
  escapes: (text, index) =>
    !WORD.test(text.charAt(index - 1)) || !WORD.test(text.charAt(index + 1)),
}

/**
 * `*` with a space or tab on both sides is neither left- nor right-flanking,
 * so it can do nothing (CommonMark 6.2): `2 * 3`. Anything else is escaped as
 * before, a line's first character included, where it would be a bullet.
 */
const ASTERISK: Narrowing = {
  character: '*',
  replaces: (pattern) => isEverywhereInProse(pattern, '*'),
  escapes: (text, index) =>
    !/^[ \t]$/.test(text.charAt(index - 1)) || !/^[ \t]$/.test(text.charAt(index + 1)),
}

/**
 * `&` starts a character reference only when a name or number and a `;`
 * follow (CommonMark 2.5), so `B&B` keeps its ampersand and `&amp;` written as
 * text is still escaped. A name that runs to the edge of the text node is
 * escaped too: what follows it there is not known.
 */
const AMPERSAND: Narrowing = {
  character: '&',
  replaces: (pattern) => pattern.character === '&' && pattern.after === '[#A-Za-z]',
  escapes: (text, index) => /^#?[A-Za-z0-9]*(?:;|$)/.test(text.slice(index + 1)),
}

/**
 * `[` in prose can only become a link through a definition — `[name]`,
 * `[text][name]`, `[^name]` — or by being followed by `](`, whose `(` the
 * library escapes on its own. A document with no definitions and no footnote
 * definitions therefore needs no `\[` in its prose, and `[name]` stays as it
 * was written. At the start of a line a bracket can still begin a definition of
 * its own (`[name]:`) or a task checkbox (`[ ]`, `[x]`), so one that could is
 * escaped there, as is one whose label runs past the text node, where what
 * follows is not known. The library's label rule still escapes a bracket inside
 * a link's text. GFM footnotes add a rule of their own, for prose and labels
 * alike, which goes with the prose rule.
 */
const BRACKET: Narrowing = {
  character: '[',
  replaces: (pattern) =>
    isEverywhereInProse(pattern, '[') ||
    (pattern.character === '[' && pattern.atBreak === true && pattern.before === undefined),
  escapes: (text, index) =>
    startsLine(text, index) && /^\[(?:[ \txX]\]|[^\]]*(?:\]:|$))/.test(text.slice(index)),
}

/** A rule's construct names, as a list. */
function constructs(list: Unsafe['inConstruct']): readonly string[] {
  return list === undefined || list === null ? [] : typeof list === 'string' ? [list] : list
}

/**
 * Whether a rule applies inside the constructs being written, as
 * `mdast-util-to-markdown` decides it: one of its constructs is open, and none
 * of the constructs it excludes.
 */
function inScope(stack: State['stack'], pattern: Unsafe): boolean {
  const within = constructs(pattern.inConstruct)
  const outside = constructs(pattern.notInConstruct)
  return (
    (within.length === 0 || stack.some((name) => within.includes(name))) &&
    !stack.some((name) => outside.includes(name))
  )
}

/** Whether `index` is the first character of a line of `text`, indentation aside. */
function startsLine(text: string, index: number): boolean {
  return /(?:^|\n)[ \t]*$/.test(text.slice(0, index))
}

/**
 * `#` starts a heading only at the start of a line and followed by a space, a
 * tab or the end of the line, after at most six (CommonMark 4.2), so `#253` at
 * the start of a list item keeps its bare hash.
 */
const HASH: Narrowing = {
  character: '#',
  replaces: (pattern) =>
    pattern.character === '#' && pattern.atBreak === true && pattern.after === undefined,
  escapes: (text, index) =>
    startsLine(text, index) && /^#{1,6}(?:[ \t\n]|$)/.test(text.slice(index)),
}

/**
 * GFM's `www.` autolinks need the `www` (GFM 6.9); the library escapes the dot
 * after any `w`, so `draw.io` became `draw\.io`. Only a dot after `www` that
 * could continue an address is escaped.
 */
const WWW_DOT: Narrowing = {
  character: '.',
  replaces: (pattern) => pattern.character === '.' && pattern.before === '[Ww]',
  escapes: (text, index) =>
    /[Ww]{3}$/.test(text.slice(0, index)) && /^[-.\w]/.test(text.slice(index + 1)),
}

/**
 * The text handler, with `narrowings` in place of the library's rules for
 * their characters. The library escapes each of these characters wherever it
 * appears in prose; its unsafe patterns cannot say "only where it would pair",
 * because `safe()` drops a conditional escape beside an unconditional one. So
 * the narrowed characters are taken out of the state's rules while the node is
 * written, each one the rules say needs it is written as `\` and the
 * character, and everything between is escaped by the library as before, with
 * the characters either side as its context.
 */
function narrowedText(narrowings: readonly Narrowing[]): TextHandler {
  // Worked out once per write, and per set of open constructs: a long document
  // has thousands of text nodes and a handful of distinct places they sit.
  interface Prepared {
    readonly lighter: State['unsafe']
    readonly active: Map<string, ReadonlySet<string>>
  }
  const prepared = new WeakMap<State['unsafe'], Prepared>()
  const characters = new Map(narrowings.map((narrowing) => [narrowing.character, narrowing]))
  const prepare = (unsafe: State['unsafe']): Prepared => ({
    lighter: unsafe.filter((pattern) => !narrowings.some(({ replaces }) => replaces(pattern))),
    active: new Map(),
  })
  // A narrowing stands in for its rule only where that rule applies: nowhere
  // in an autolink, for one, where a backslash would be read as part of the address.
  const activeIn = (unsafe: State['unsafe'], stack: State['stack']): ReadonlySet<string> =>
    new Set(
      narrowings
        .filter(({ replaces }) =>
          unsafe.some((pattern) => replaces(pattern) && inScope(stack, pattern)),
        )
        .map(({ character }) => character),
    )
  return (node, _parent, state, info) => {
    const unsafe = state.unsafe
    const { lighter, active: byStack } = prepared.get(unsafe) ?? prepare(unsafe)
    prepared.set(unsafe, { lighter, active: byStack })
    const where = state.stack.join(' ')
    const active = byStack.get(where) ?? activeIn(unsafe, state.stack)
    byStack.set(where, active)
    const { value } = node
    const context = `${info.before}${value}${info.after}`
    const escaped: number[] = []
    for (let index = 0; index < value.length; index += 1) {
      const character = value.charAt(index)
      const rule = active.has(character) ? characters.get(character) : undefined
      if (rule?.escapes(context, info.before.length + index) === true) escaped.push(index)
    }
    state.unsafe = lighter
    try {
      let written = ''
      let from = 0
      const between = (to: number): string =>
        state.safe(value.slice(from, to), {
          ...info,
          before: from === 0 ? info.before : value.charAt(from - 1),
          after: to === value.length ? info.after : value.charAt(to),
        })
      for (const at of escaped) {
        written += `${between(at)}\\${value.charAt(at)}`
        from = at + 1
      }
      return written + between(value.length)
    } finally {
      state.unsafe = unsafe
    }
  }
}

/** Prose escaping for a document with link reference or footnote definitions. */
export const PROSE_ESCAPES: ToMarkdownExtension = {
  handlers: { text: narrowedText([TILDE, UNDERSCORE, ASTERISK, AMPERSAND, HASH, WWW_DOT]) },
}

/** Prose escaping for a document with neither, where no bracket can become a link. */
export const PROSE_ESCAPES_WITHOUT_REFERENCES: ToMarkdownExtension = {
  handlers: {
    text: narrowedText([TILDE, UNDERSCORE, ASTERISK, AMPERSAND, HASH, WWW_DOT, BRACKET]),
  },
}

export interface ToMarkdownExtensionOptions {
  /**
   * Whether the document has link reference or footnote definitions, which a
   * bracket in its prose could be read as a reference to.
   */
  readonly references: boolean
}

/**
 * Registers this package's `toMarkdown` extensions.
 *
 * `remark-stringify` discards an `extensions` option — it overwrites it with the
 * processor's `toMarkdownExtensions` — so the extensions have to be pushed onto
 * that list by a plugin.
 */
export function remarkToMarkdownExtensions(
  this: Processor,
  options: ToMarkdownExtensionOptions = { references: true },
): undefined {
  const data = this.data()
  const extensions = (data.toMarkdownExtensions ?? []).map(withoutBroadColonEscape)
  extensions.push(
    DIRECTIVE_COLON_ESCAPE,
    BYTE_ORDER_MARK_ESCAPE,
    rawMdastToMarkdown,
    codeGroupToMarkdown,
    detailsToMarkdown,
    options.references ? PROSE_ESCAPES : PROSE_ESCAPES_WITHOUT_REFERENCES,
  )
  extensions.push(
    sourceFormToMarkdown({
      listItem: registeredHandler(extensions, 'listItem'),
      table: registeredHandler(extensions, 'table'),
      containerDirective: registeredHandler(extensions, 'containerDirective'),
      leafDirective: registeredHandler(extensions, 'leafDirective'),
      textDirective: registeredHandler(extensions, 'textDirective'),
    }),
  )
  data.toMarkdownExtensions = extensions
}

/** The handler the last of `extensions` to register one has for a node type, nested ones included. */
function registeredHandler(
  extensions: readonly ToMarkdownExtension[],
  type: keyof Handlers,
): Handle | undefined {
  for (const extension of extensions.toReversed()) {
    const handler =
      extension.handlers?.[type] ?? registeredHandler(extension.extensions ?? [], type)
    if (handler !== undefined) return handler
  }
  return undefined
}

/**
 * `mdast-util-directive` escapes every `:` before a letter, which rewrites
 * `:smile:` as `\:smile:` on every save although it could never read as a
 * directive. Its rule is taken out; `DIRECTIVE_COLON_ESCAPE` covers every
 * colon it covered that would actually open one.
 */
function withoutBroadColonEscape(extension: ToMarkdownExtension): ToMarkdownExtension {
  const unsafe = extension.unsafe?.filter(
    (pattern) => !(pattern.character === ':' && pattern.after === '[A-Za-z]'),
  )
  return unsafe === undefined ? extension : { ...extension, unsafe }
}
