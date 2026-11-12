/**
 * What a formula's MathML may contain, and nothing else (ADR-064, ADR-039's
 * "the sanitiser runs last").
 *
 * The MathML is made by Temml from TeX an author wrote, so it is checked twice
 * against this one description: once as it is read off Temml's tree (`tree.ts`),
 * which keeps what is listed here and drops the rest, and once more by the
 * document's sanitiser (`render/sanitize-schema.ts`), which is built from the
 * same lists and is the last word on what a page contains. Neither list is
 * "any": every element is named, and every attribute has the shape of its
 * values.
 *
 * Nothing here can run script, load anything, link anywhere, or name an
 * element of the page (`id`, `href`, `style`, `xmlns` and event handlers are
 * absent, and Temml refuses the commands that would write them unless it is
 * told to trust the author, which it is not).
 */

/** The elements Temml builds a formula from. `maction`, `semantics` and `annotation` are not among them. */
export const MATH_TAGS = [
  'math',
  'mi',
  'mn',
  'mo',
  'ms',
  'mtext',
  'mspace',
  'mrow',
  'mfrac',
  'msqrt',
  'mroot',
  'mstyle',
  'mpadded',
  'mphantom',
  'menclose',
  'msub',
  'msup',
  'msubsup',
  'munder',
  'mover',
  'munderover',
  'mmultiscripts',
  'mprescripts',
  'none',
  'mtable',
  'mtr',
  'mtd',
] as const

const BOOLEAN = /^(?:true|false)$/u
/** A number, with a unit when it has one: `0.2222em`, `-3pt`, `100%`. */
const LENGTH = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:em|ex|px|pt|pc|cm|mm|in|%)?$/u
/** One or more lengths, or MathML's named spaces, as `rowspacing` and `linethickness` take them. */
const LENGTHS =
  /^(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:em|ex|px|pt|pc|cm|mm|in|%)?|[a-z]+mathspace|thin|medium|thick)(?: (?:[+-]?(?:\d+\.?\d*|\.\d+)(?:em|ex|px|pt|pc|cm|mm|in|%)?|[a-z]+mathspace))*$/u
const WORDS = /^[a-z]+(?: [a-z]+)*$/u
const COLOUR = /^(?:#[0-9a-fA-F]{3,8}|[a-z]+)$/u

/**
 * The attributes any of those elements may carry, and what their values look like. These are
 * MathML's presentation attributes, which Temml writes where TeX has a command for them.
 */
export const MATH_ATTRIBUTES: Readonly<Record<string, RegExp>> = {
  display: /^block$/u,
  displaystyle: BOOLEAN,
  scriptlevel: /^[+-]?\d$/u,
  mathvariant: /^[a-z-]+$/u,
  mathsize: LENGTH,
  mathcolor: COLOUR,
  mathbackground: COLOUR,
  form: /^(?:prefix|infix|postfix)$/u,
  fence: BOOLEAN,
  separator: BOOLEAN,
  stretchy: BOOLEAN,
  symmetric: BOOLEAN,
  largeop: BOOLEAN,
  movablelimits: BOOLEAN,
  accent: BOOLEAN,
  accentunder: BOOLEAN,
  lspace: LENGTH,
  rspace: LENGTH,
  width: LENGTH,
  height: LENGTH,
  depth: LENGTH,
  voffset: LENGTH,
  minsize: LENGTH,
  maxsize: LENGTH,
  linethickness: LENGTHS,
  rowspacing: LENGTHS,
  columnalign: WORDS,
  rowalign: WORDS,
  columnspan: /^\d{1,3}$/u,
  rowspan: /^\d{1,3}$/u,
  notation: WORDS,
  linebreak: /^(?:newline|nobreak|auto|goodbreak|badbreak)$/u,
}

/**
 * The classes Temml gives its output (`tml-display`, `mathcal`, `chr-sml`…), and the ones
 * `STYLE_CLASSES` stands in for a style with. A class styles only where `prose.css` defines it.
 */
export const MATH_CLASS = /^[a-z][a-z\d-]*$/u

/**
 * Temml writes a little of a formula's layout as an inline `style`, which a page under this
 * application's content security policy (`style-src 'self'`) cannot carry, so none is kept. The
 * few that matter are classes instead: the padding a table cell is given, the widths that hold a
 * tagged equation's number at the edge, the rules of `\hline`, and the one alignment. Each key is
 * a declaration as Temml writes it; each value is the class `prose.css` gives it.
 *
 * Anything not here (a colour, a size from `\rule`) is dropped, which leaves the formula where
 * the browser's own MathML styles put it: the same formula, a little plainer.
 */
export const STYLE_CLASSES: Readonly<Record<string, string>> = {
  'width:100%': 'tml-w-100',
  'width:50%': 'tml-w-50',
  'width:7.5%': 'tml-w-8',
  'padding:0': 'tml-p-0',
  'padding-left:0': 'tml-pl-0',
  'padding-left:0em': 'tml-pl-0',
  'padding-right:0': 'tml-pr-0',
  'padding-right:0em': 'tml-pr-0',
  'padding-top:0': 'tml-pt-0',
  'padding-bottom:0': 'tml-pb-0',
  'text-align:left': 'tml-left',
  'math-depth:0': 'tml-depth-0',
  'border-top:0.06em solid': 'tml-bt-solid',
  'border-top:0.06em dashed': 'tml-bt-dashed',
  'border-top:0.15em double': 'tml-bt-double',
  'border-bottom:0.06em solid': 'tml-bb-solid',
  'border-bottom:0.06em dashed': 'tml-bb-dashed',
  'border-bottom:0.15em double': 'tml-bb-double',
}
