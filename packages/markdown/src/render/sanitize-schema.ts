import { defaultSchema } from 'hast-util-sanitize'
import type { Schema } from 'hast-util-sanitize'

import { CALLOUT_TYPES } from '../directives/callout.ts'
import { LAYOUT_DIRECTIVE_NAMES } from '../directives/layout.ts'
import { HEADING_ID_PREFIX } from './slug.ts'

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

// `Schema['attributes']`/`Schema['tagNames']` are typed as optional because a
// *caller-supplied* schema may omit them; `hast-util-sanitize`'s own
// `defaultSchema` (`lib/schema.js`) always defines both, so the `?? {}`/`?? []`
// fallbacks below exist only to satisfy that wider type and are never actually
// taken with the real import.
/* v8 ignore next -- see comment above */
const defaultAttributes = defaultSchema.attributes ?? {}

const attributes: Schema['attributes'] = {
  ...defaultAttributes,

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
  a: [
    ...ARIA,
    'dataFootnoteBackref',
    'dataFootnoteRef',
    ['className', 'data-footnote-backref', 'heading-anchor'],
    ARIA_LABEL,
    ['href', /^(?!\/\/)/],
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
  aside: [['className', ...CALLOUT_CLASSES, 'guidance'], ['role', 'note'], ARIA_LABEL],

  // `handlers.ts`'s `containerDirective`: the `:::wide`/`:::full` layout wrappers
  // and the block placeholder. `itemScope`/`itemType` are the default's own.
  /* v8 ignore next -- see the note above `defaultAttributes`: always defined. */
  div: [...(defaultAttributes['div'] ?? []), ['className', ...LAYOUT_CLASSES, 'placeholder']],

  // `handlers.ts`'s `callout`: the optional `[Label]` paragraph rendered above a
  // callout's body.
  p: [['className', 'callout-label']],

  // `handlers.ts`'s `labelledSection`: the optional/repeat template sections,
  // and `leafDirective`'s live-block slot (ADR-032), whose `data-live-block`
  // names the block type. That value is a directive name straight from the
  // parser, which admits no quotes or whitespace, and it is emitted as a literal
  // already-hyphenated property key the way `data-lang` is.
  // `dataFootnotes` and the `footnotes` class are the default's own GFM
  // footnote support (mdast-util-to-hast's built-in handler), kept so footnote
  // rendering keeps working if a document uses it.
  section: [
    'dataFootnotes',
    ['className', 'footnotes', 'live-block', 'optional', 'repeat'],
    'data-live-block',
    ARIA_LABEL,
  ],

  // `handlers.ts`'s `textDirective`: the inline `:placeholder[...]` span.
  span: [['className', 'placeholder']],

  // `handlers.ts`'s `row`/`cellProperties`: column-alignment classes. `scope`
  // (for `th`) is already in the default's `'*'` list below.
  td: [['className', 'align-left', 'align-right', 'align-center']],
  th: [['className', 'align-left', 'align-right', 'align-center']],

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
  img: [...ARIA, 'longDesc', ['src', DATA_IMAGE, NOT_DATA]],
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
  'figure', // handlers.ts: a captioned image
  'figcaption',
  'time', // html.ts: front-matter dates, always an absolute `datetime` (ADR-031)
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
