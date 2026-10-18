import { LINK_DISPLAYS } from '@quill/domain'
import { defaultSchema } from 'hast-util-sanitize'
import type { Schema } from 'hast-util-sanitize'

import { BADGE_TONES } from '../directives/badge.ts'
import { CALLOUT_TYPES } from '../directives/callout.ts'
import { CARDS_VARIANTS } from '../directives/cards.ts'
import { LABEL_NAME } from '../directives/label.ts'
import { LAYOUT_DIRECTIVE_NAMES, LAYOUT_WIDTHS } from '../directives/layout.ts'
import { TABLE_FREEZE_VALUES, TABLE_PERCENTS } from '../directives/table.ts'
import { CODE_SANITIZE_GRANT } from '../code-group/render.ts'
import { DETAILS_SANITIZE_GRANT } from '../details/render.ts'
import { EMOJI_SANITIZE_GRANT } from '../emoji/emoji.ts'
import { HEADING_ID_PREFIX } from './slug.ts'
import { CELL_LABEL_LIMIT } from './table-columns.ts'

/**
 * The sanitisation schema `renderHtml` (./html.ts) runs every document through,
 * server-side, before anything reaches the render cache (ADR-011 "Input, output,
 * and content"; ADR-031; `docs/security/review-2026-09-12-m1-auth.md` finding 3).
 *
 * It starts from hast-util-sanitize's `defaultSchema` — the same allowlist GitHub
 * sanitises rendered Markdown with — and adds only the elements and attributes
 * `createHandlers` (./handlers.ts) and `renderHtml` (./html.ts) emit themselves.
 * Every addition below is traced to the handler that emits it and justified in a
 * comment; nothing here is a general-purpose widening.
 *
 * `hast-util-sanitize`'s `sanitize()` merges the schema it is given onto
 * `defaultSchema` with `{...defaultSchema, ...options}` — a shallow merge. A
 * schema that just set `tagNames` or `attributes` to "the extra bits" would
 * silently discard every default entry for the keys it touches (dropping, for
 * example, all of GitHub's standard inline formatting). Every touched key here is
 * therefore built as "the default's own value, plus the extension", never a bare
 * replacement.
 */

// hast-util-sanitize's own `aria` allowlist (three ARIA attributes it permits in
// several, but not all, places). Reproduced because the library does not export
// this constant for reuse.
const ARIA = ['ariaDescribedBy', 'ariaLabel', 'ariaLabelledBy'] as const

// `handlers.ts`'s `heading`, `callout`, `labelledAside`, and `labelledSection`
// handlers all set `'aria-label'` as a literal, already-hyphenated hast property
// key — not the camelCase `ariaLabel` that hast-util-sanitize's own `aria` list
// (above) matches. The two are different object keys to hast-util-sanitize's
// attribute matcher, so the default allowance never actually covers our output;
// this literal must be listed explicitly on every tag that carries it.
const ARIA_LABEL = 'aria-label'

// The callout aside's class list (`handlers.ts`'s `callout`): the base `callout`
// class plus one `callout-<type>` per known type. `calloutDirective.parse` maps
// any other `type` attribute value to `DEFAULT_CALLOUT_TYPE`, so this is exactly
// and only the set of class names that handler can produce.
const CALLOUT_CLASSES = ['callout', ...CALLOUT_TYPES.map((type) => `callout-${type}`)]

// The layout wrapper's class list (`handlers.ts`'s `containerDirective`):
// `layoutDirective.parse` only ever returns one of `LAYOUT_DIRECTIVE_NAMES`.
const LAYOUT_CLASSES = LAYOUT_DIRECTIVE_NAMES.map((name) => `layout-${name}`)

// The raster image types an inline `data:` payload may carry. Each is decoded
// by the image pipeline and can do nothing else; `image/svg+xml` is deliberately
// absent, because an SVG is a document that can carry script and fetch external
// references, and a `data:` one would run with this page's origin.
const DATA_IMAGE_TYPES = ['png', 'jpeg', 'gif', 'webp', 'avif'] as const

const DATA_IMAGE = new RegExp(`^data:image/(?:${DATA_IMAGE_TYPES.join('|')})[;,]`, 'i')

const NOT_DATA = /^(?!data:)/i

// A table block's options (ADR-040; `handlers.ts`'s `tableBlockProperties`).
// Every value is one the renderer can produce, listed or patterned exactly:
// a named width or `percent` with one of the stylesheet's steps; the frozen
// parts in their fixed order; the row-header kinds; `stack`; `off`; `bottom`.
const TABLE_BLOCK_ATTRIBUTES: NonNullable<Schema['attributes']>[string] = [
  ['data-width', ...LAYOUT_WIDTHS, 'percent'],
  ['data-percent', ...TABLE_PERCENTS],
  ['data-freeze', ...TABLE_FREEZE_VALUES],
  ['data-headers', 'row', 'both'],
  ['data-caption', 'bottom'],
  ['data-responsive', 'stack'],
  ['data-sort', 'off'],
]

// A stacked cell's column name (`handlers.ts`'s `cellProperties`): header
// text, cut to `CELL_LABEL_LIMIT` characters, on one line. It is only ever
// an attribute value, escaped by the serialiser, and drawn by CSS
// `content: attr(data-label)`, which renders text and nothing else.
const CELL_LABEL = new RegExp(`^[^\\n\\r]{0,${CELL_LABEL_LIMIT}}$`, 'u')

// The alignment classes a cell can carry: the author's, or `align-numeric`
// for a column of numbers.
const ALIGN_CLASSES = [
  'align-left',
  'align-right',
  'align-center',
  'align-numeric',
  'column-nowrap',
  'column-long',
] as const

// A stacked table's explicit roles (`table-block.ts`): each the element's
// own implicit role, restated, and nothing else. A `th` heads a column or,
// with `scope="row"`, a row.
const TABLE_ROLES = {
  table: ['table'],
  rowgroup: ['rowgroup'],
  tr: ['row'],
  th: ['columnheader', 'rowheader'],
  td: ['cell'],
} as const

// A caption's id (`table-block.ts`), which the scroll region it names is
// labelled by. Matched before the sanitiser prefixes the reference, as it
// prefixes every id; a heading's slug never holds a dot, so the two cannot
// collide. The caption's own `id` is the default's `'*'` attribute, which is
// prefixed like every other and so can never clobber the page's.
const CAPTION_ID = /^caption\.\d{1,4}$/

// A callout's title paragraph (`handlers.ts`'s `calloutAside`), which names
// its aside, numbered in document order like a caption.
const CALLOUT_TITLE_ID = /^callout\.\d{1,4}$/

// A heading's words (`handlers.ts`'s `heading`), which name the heading so
// its permalink is not part of its name. The slug after the dot is the
// slugger's, which holds no whitespace, so the reference is one id.
const HEADING_TITLE_ID = /^title\.\S+$/u

// The headings, each named only by its own words.
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

// `Schema['attributes']`/`Schema['tagNames']` are typed as optional because a
// *caller-supplied* schema may omit them; `hast-util-sanitize`'s own
// `defaultSchema` (`lib/schema.js`) always defines both, so the `?? {}`/`?? []`
// fallbacks below exist only to satisfy that wider type and are never actually
// taken with the real import.
/* v8 ignore next -- see comment above */
const defaultAttributes = defaultSchema.attributes ?? {}

/**
 * The default's every-element attributes, less two that mean something only
 * on a details (ADR-048): `open` and `name`, which a details is granted in
 * its own shape. Left global, either would be admitted on any element with
 * any value, whatever the details grant says.
 */
const DETAILS_ONLY: ReadonlySet<unknown> = new Set(['open', 'name'])

const attributes: Schema['attributes'] = {
  ...defaultAttributes,

  /* v8 ignore next -- see the note above `defaultAttributes`: always defined. */
  '*': (defaultAttributes['*'] ?? []).filter((definition) => !DETAILS_ONLY.has(definition)),

  // `handlers.ts`'s `heading` handler emits the permalink anchor after every
  // heading (`class="heading-anchor"`, `href="#<slug>"`, a literal `aria-label`).
  // `href` and the footnote-backref class are already in the default. `rel` is
  // not listed here: `external-link-rel.ts` adds it after this schema has already
  // run, as a fixed, trusted value, so there is nothing untrusted for the schema
  // to police.
  // The `href` pattern rejects a protocol-relative `//host/path`, which the
  // scheme allowlist below cannot: hast-util-sanitize sees no scheme before the
  // first `/` and treats the value as relative, so `//evil.example/x` would be
  // let through as if it were a document reference. ADR-011 says a link is
  // http(s), mailto, or a relative or id-based reference to our own content;
  // a value that silently inherits the page's scheme and leaves the origin is
  // none of those, and an author who means an external link can write one.
  // The anchor's `#` is a span hidden from assistive technology, admitted by
  // the emoji grant's `aria-hidden` below; the link is named by its label.
  a: [
    ...ARIA,
    'dataFootnoteBackref',
    'dataFootnoteRef',
    ['className', 'data-footnote-backref', 'heading-anchor'],
    ARIA_LABEL,
    ['href', /^(?!\/\/)/],
    // `link-slots.ts`'s slot (ADR-042): what the author chose for a link and the
    // address its preview is stored under. Inert text and fixed words; the page
    // reads them and nothing executes them. `display` and `layout` are the
    // directive's own enumerations, `image` has the one value `none`.
    'data-link-slot',
    'data-link-key',
    'data-link-internal',
    'data-link-words',
    'data-title',
    'data-description',
    ['data-display', ...LINK_DISPLAYS],
    ['data-layout', 'side', 'top'],
    ['data-image', 'none'],
  ],

  // `handlers.ts`'s `code` handler: `data-lang` names a fenced block's language,
  // `data-tokens` carries the packed syntax-highlighting ranges the server
  // computes (ADR-030). Both are literal, already-hyphenated property keys.
  /* v8 ignore next -- see the note above `defaultAttributes`: always defined. */
  code: [...(defaultAttributes['code'] ?? []), 'data-lang', 'data-tokens'],

  // `html.ts`'s `documentHeader`: the front-matter summary block wrapping the
  // `dl` of dates.
  header: [['className', 'document-meta']],

  // `handlers.ts`'s `callout` and `labelledAside`: the callout and guidance
  // asides. `role` is always exactly `"note"`; the accessible name is carried
  // by `aria-label`, never by content alone. Presenter notes are not an aside
  // a reader can be served: `renderHtml` removes them before rendering.
  // A callout is named by its title paragraph instead (`calloutAside`), and
  // only ever by one in a callout title's shape.
  aside: [
    ['className', ...CALLOUT_CLASSES, 'guidance'],
    ['role', 'note'],
    ARIA_LABEL,
    ['ariaLabelledBy', CALLOUT_TITLE_ID],
  ],

  // `handlers.ts`'s `heading`: named by the span holding its words.
  ...Object.fromEntries(
    HEADINGS.map((tag) => [tag, [['ariaLabelledBy', HEADING_TITLE_ID]]] as const),
  ),

  // `task-list.ts`'s `listItem`: a task's checkbox, named by the task's words.
  // `type` and `disabled` stay the default's own, which also *requires* them
  // (`defaultSchema.required.input`), so a name is all this adds: whatever
  // else an input carries, it is still only ever a disabled checkbox.
  /* v8 ignore next -- see the note above `defaultAttributes`: always defined. */
  input: [...(defaultAttributes['input'] ?? []), ARIA_LABEL],

  // `handlers.ts`'s `containerDirective`: the `:::wide`/`:::full` layout wrappers
  // and the block placeholder; `cards`, whose `data-variant` is one of
  // `CARDS_VARIANTS` because `cardsDirective.parse` maps anything else to the
  // default; and `code`'s diagram slot, whose `data-diagram` is one of the
  // fixed `DIAGRAM_LANGUAGES`. Both values are listed, so a document cannot
  // carry any other. `itemScope`/`itemType` are the default's own.
  /* v8 ignore next -- see the note above `defaultAttributes`: always defined. */
  div: [
    ...(defaultAttributes['div'] ?? []),
    [
      'className',
      ...LAYOUT_CLASSES,
      'placeholder',
      'cards',
      'diagram',
      'table-block',
      'table-scroll',
      ...CODE_SANITIZE_GRANT.classes.div,
      ...DETAILS_SANITIZE_GRANT.classes.div,
    ],
    ...TABLE_BLOCK_ATTRIBUTES,
    // A table's scroll container: focusable only ever with 0, and a group
    // named only ever "Table", or by its table's caption.
    ['tabIndex', 0],
    ['role', 'group'],
    ['ariaLabel', 'Table'],
    ['ariaLabelledBy', CAPTION_ID],
    ['data-variant', ...CARDS_VARIANTS],
    ['data-diagram', 'mermaid', 'svg'],
    // A code block's card and a code group (ADR-041), whose `data-sync` is
    // only ever a sync key's own shape.
    ...CODE_SANITIZE_GRANT.attributes.div,
  ],

  // `handlers.ts`'s `calloutAside`: the title paragraph rendered above a
  // callout's body. Its `id` is the default's `'*'` attribute, prefixed.
  p: [['className', 'callout-label', 'link-slot-block']],

  // `details/render.ts` (ADR-048): the browser's own details, a callout's
  // classes when it is a folded callout, `open`, and a name only in a
  // name's shape. `details` and `summary` are the default's own elements;
  // `open` and `name` are taken out of the default's every-element list
  // below, so this is the only element that can carry either.
  details: [
    ['className', ...DETAILS_SANITIZE_GRANT.classes.details],
    ...DETAILS_SANITIZE_GRANT.attributes.details,
  ],

  // `code-group/render.ts`'s `codeCard` (ADR-041): a titled code block, or a
  // tab of a code group, is a figure captioned by its name and its file.
  figure: [['className', ...CODE_SANITIZE_GRANT.classes.figure]],
  figcaption: [['className', ...CODE_SANITIZE_GRANT.classes.figcaption]],

  // `handlers.ts`'s `labelledSection`: the optional/repeat template sections,
  // and `leafDirective`'s live-block slot (ADR-032), whose `data-live-block`
  // names the block type. That value is a directive name straight from the
  // parser, which admits no quotes or whitespace, and it is emitted as a literal
  // already-hyphenated property key the way `data-lang` is.
  // `dataFootnotes` and the `footnotes` class are the default's own GFM
  // footnote support (mdast-util-to-hast's built-in handler), kept so footnote
  // rendering keeps working if a document uses it.
  // `data-depth` is the `::children` block's parameter, a number from the
  // directive definition and never the author's text.
  section: [
    'dataFootnotes',
    ['className', 'footnotes', 'live-block', 'optional', 'repeat', 'card'],
    'data-live-block',
    ['data-depth', /^[1-5]$/],
    ARIA_LABEL,
  ],

  // `handlers.ts`'s `tableOfContents`: the `::toc` block's navigation landmark.
  nav: [['className', 'toc'], ARIA_LABEL],

  // `handlers.ts`'s `textDirective`: the inline `:placeholder[...]` span, and
  // `:badge[...]`, whose `data-tone` is one of `BADGE_TONES` because
  // `badgeDirective.parse` maps anything else to neutral. A tenant label
  // (ADR-037) is a badge whose `data-label` is the label's name, admitted only
  // in the name's own shape, which the theme validates the same way and
  // which holds nothing but lower-case letters, digits and hyphens.
  // `cellContent`'s status and detail lines of a table cell.
  // An emoji (ADR-038) is the emoji module's own grant, merged in here: a
  // span named as an image, or hidden when it decorates a label's pill.
  span: [
    [
      'className',
      'placeholder',
      'badge',
      'cell-status',
      'cell-detail',
      'table-caption-text',
      // A callout's type, said before an author's title (`calloutAside`).
      'sr-only',
      ...EMOJI_SANITIZE_GRANT.classes.span,
      ...CODE_SANITIZE_GRANT.classes.span,
    ],
    ['data-tone', ...BADGE_TONES],
    ['data-label', LABEL_NAME],
    ...EMOJI_SANITIZE_GRANT.attributes.span,
  ],

  // `handlers.ts`'s `row`/`cellProperties`: column-alignment classes, a
  // stacked cell's column name, and a stacked table's roles. `scope` (for
  // `th`) is already in the default's `'*'` list below.
  td: [
    ['className', ...ALIGN_CLASSES],
    ['data-label', CELL_LABEL],
    ['role', ...TABLE_ROLES.td],
  ],
  th: [
    ['className', ...ALIGN_CLASSES],
    ['role', ...TABLE_ROLES.th],
  ],
  table: [['role', ...TABLE_ROLES.table]],
  thead: [['role', ...TABLE_ROLES.rowgroup]],
  tbody: [['role', ...TABLE_ROLES.rowgroup]],
  tfoot: [['role', ...TABLE_ROLES.rowgroup]],
  tr: [['role', ...TABLE_ROLES.tr]],

  // `handlers.ts`'s `image`/`figure`. `alt` and `title` are already global.
  // `src` is the only place this schema allows `data:` at all, and only for one
  // of the raster types below — see `protocols.src`, which is what admits the
  // `data:` scheme past the protocol gate so this pattern can run at all.
  // `image/*` was too wide: `image/svg+xml` is a document, with scripts and
  // external references, and a browser renders it as one. Every other value
  // (relative paths, `//host/path`, `http:`, `https:`) is let through by the
  // second pattern; the scheme allowlist keeps those to http(s).
  //
  // The two patterns and the protocol gate agree on case, which they did not
  // before: the gate compares a scheme byte for byte, so an uppercased `DATA:`
  // never reaches these patterns at all, while `NOT_DATA` carried `i` and so
  // read as if it might. Both patterns keep `i` — a media type is
  // case-insensitive, so `data:image/PNG` is a `data:image/png` — and the
  // exclusion stays case-insensitive too, so neither pattern is the only thing
  // standing between an uppercased scheme and the allowlist.
  //
  // The second pattern is also what lets an attachment through: a document
  // that shows an uploaded file carries `/api/attachments/<id>`, a relative
  // same-origin path with no scheme, which hast-util-sanitize treats as
  // relative and this pattern admits. It has to keep working, and it has to
  // keep agreeing with the CSP that meets it in a browser — `img-src 'self'`
  // (`apps/server/src/plugins/security-headers.ts`) — which is what
  // `render.security.test.ts`'s "attachment images" cases hold in place.
  //
  // TODO(M4): export rewrites `/api/attachments/<id>` to a path inside the
  // exported bundle so a downloaded document is self-contained (quill-plan.md
  // section 24). It is a substitution over the emitted `src`, not a change
  // here: this schema admits relative paths of every shape already.
  //
  // A custom emoji (ADR-038) adds the `emoji` class, and nothing else: its
  // `width`, `height`, `alt` and `title` are the default's own, and
  // `guardEmojiImages` takes the class off any image whose `src` is not an
  // emoji's address after this schema has run.
  img: [
    ...ARIA,
    'longDesc',
    ['src', DATA_IMAGE, NOT_DATA],
    ['className', ...EMOJI_SANITIZE_GRANT.classes.img],
  ],

  // An animated custom emoji (ADR-038): its image inside a `picture` whose
  // one `source` offers the still under reduced motion. The grant replaces
  // the default's `source: ['srcSet']`, which admitted any address at all.
  picture: [
    ['className', ...EMOJI_SANITIZE_GRANT.classes.picture],
    ...EMOJI_SANITIZE_GRANT.attributes.picture,
  ],
  source: EMOJI_SANITIZE_GRANT.attributes.source,
}

// `defaultSchema.tagNames` is always defined (see the note above
// `defaultAttributes`); `??` only satisfies the wider `Schema` type.
/* v8 ignore next -- see comment above */
const knownTagNames = defaultSchema.tagNames ?? []

const tagNames = [
  ...knownTagNames,
  'article', // html.ts: the document's top-level wrapper
  'header', // html.ts: documentHeader
  'aside', // handlers.ts: callout, guidance
  'nav', // handlers.ts: the table of contents
  'figure', // handlers.ts: a captioned image, and `:::figure`
  'figcaption',
  'small', // handlers.ts: `:small[...]`
  'time', // html.ts: front-matter dates, always an absolute `datetime` (ADR-031)
  // handlers.ts: a table's proportional column widths (ADR-040). Their
  // `width` is the default's own `'*'` attribute.
  'colgroup',
  'col',
  'caption', // handlers.ts: a table's caption, which names it (ADR-040)
]

const protocols: Schema['protocols'] = {
  ...defaultSchema.protocols,
  // ADR-011: links to other content are http(s), mailto, or a relative/id-based
  // document reference — never anything else. hast-util-sanitize treats a value
  // with no scheme before its first `/`, `?`, or `#` as relative and allows it
  // regardless of this list, so `/d/<document id>` and `#heading-slug` links
  // (ADR-031) need no entry here. The default's `irc`/`ircs`/`xmpp` are dropped
  // as unused surface.
  href: ['http', 'https', 'mailto'],
  // `data:` is added for images only. This list is consulted for every element
  // with a `src` property, but `src` itself is permitted only on `img` in
  // `attributes` above, and there it is further restricted to `data:image/*` by
  // the regex pair on that definition — this entry only admits the scheme past
  // hast-util-sanitize's protocol gate so that regex can run at all.
  src: ['http', 'https', 'data'],
}

/**
 * hast-util-sanitize's own default, kept.
 *
 * Every `id` in a rendered document comes from `slug.ts`'s slugger — but a slug
 * is the author's heading text, so the *value* is author-controlled even though
 * the shape is not. Without a prefix a document could mint `id="main"` or
 * `id="search"` and collide with the application's own ids, and an element id is
 * also a global on `window`: a heading called "Config" gives the page a
 * `window.config` pointing at an element, which is the DOM-clobbering trick that
 * turns a benign-looking document into a way to confuse the code around it.
 *
 * The prefix is applied here and nowhere else. hast-util-sanitize rewrites the
 * attributes it clobbers and never the references to them, so the renderer's
 * heading anchor and `extractOutline` add `HEADING_ID_PREFIX` themselves
 * (`slug.ts`), which is what keeps a table of contents entry resolving to the
 * heading it names.
 */
const clobberPrefix = HEADING_ID_PREFIX

export const sanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames,
  attributes,
  protocols,
  clobberPrefix,
}
