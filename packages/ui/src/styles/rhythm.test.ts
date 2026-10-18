import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { styleSheetPath } from '@quill/design-css'

/**
 * The reading rhythm keeps sibling relations to a closed list (`prose.css`,
 * "Vertical rhythm").
 *
 * The editor inserts a block on every Enter. Chrome keys a sibling rule only
 * by a class, id or attribute on its left, so a rule like `.prose > * + *` or
 * `.prose > h2 + *` is re-checked on every insertion and restyles every
 * element its right side could match: with `*` there, the whole document,
 * 70 to 85 ms an Enter in a 1,200-block document (quill-plan.md section 31).
 * The rhythm is written instead as each block's own top margin and its own
 * bottom margin, so almost nothing in it needs a neighbour.
 *
 * What remains is listed here, each with why it has to be a pair and why it
 * is cheap: its subject is a heading, a rule, a details or the one lede, never
 * any block and never a table, or it never reaches the editor at all. A new
 * `+`, `~` or `:has(+ …)` in these stylesheets fails here until it is either
 * rewritten or added with its reason.
 */

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

const STYLESHEETS: Readonly<Record<string, string>> = {
  'prose.css': styleSheetPath('prose.css'),
  'layout.css': styleSheetPath('layout.css'),
  'byline.css': styleSheetPath('byline.css'),
  'comparison.css': styleSheetPath('comparison.css'),
  'public-site.css': styleSheetPath('public-site.css'),
  'editor.css': here('editor.css'),
  'table-editor.css': here('table-editor.css'),
  'editor-menus.css': here('editor-menus.css'),
}

const OBJECTS =
  'figure, pre, blockquote, .table-block, .table-scroll, .callout, .code-block, .code-group, .details, .accordion'
const OBJECTS_BUT_TABLES =
  'figure, pre, blockquote, .table-scroll, .callout, .code-block, .code-group, .details, .accordion'
const BODY_OBJECTS = 'figure, pre, blockquote, .table-block, .callout, .code-block, .code-group'
const BODY_OBJECTS_BUT_TABLES = 'figure, pre, blockquote, .callout, .code-block, .code-group'
const BYLINES = '.prose > :is(.byline, [data-byline-slot], .lifecycle-notice)'
const TABLE_ACTIVE =
  '.prose > :is(.table-block:has(> .table-editor[data-active]), .table-block.table-editor[data-active])'

const FOLLOWER =
  'the follower takes back what the block before it left below it; the subject is a heading, a rule, the footnotes or an object other than a table, and only those restyle'
const BEFORE_TABLE =
  'a table restyles its whole body, so it is never the subject of a pair: the block before it asks about it instead'
const BYLINE = 'the byline and the deprecation notice are never blocks of the editor'

/** Every sibling relation that stays, by file, with the reason it may. */
const ALLOWED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'prose.css': {
    '.prose > :is(h2, h3, h4) + :is(h2, h3, h4)': `a heading straight after a heading sits at the after-heading space in its own units; ${FOLLOWER}`,
    '.prose > :is(h2, h3, h4) + hr': FOLLOWER,
    [`.prose > :is(h2, h3, h4) + :where(${OBJECTS_BUT_TABLES}), .prose > :is(h2, h3, h4) + .footnotes`]:
      FOLLOWER,
    [`.prose > h1 + :where(h2, h3, h4, h5, h6, ${OBJECTS_BUT_TABLES})`]: FOLLOWER,
    '.prose > h1 + hr': FOLLOWER,
    '.prose > h1 + .footnotes': FOLLOWER,
    '.prose > h1 + p':
      'the lede is a typographic role, the paragraph straight after the title, and it takes the title’s space in its own size',
    ".prose :is(tfoot tr:not(:first-child) :is(th, td), [data-part='foot'] + [data-part='foot'] > *)":
      'not rhythm: the rule between two footer rows of one table in the editor, keyed by its attribute',
    '.prose > hr:has(+ .table-block)': BEFORE_TABLE,
    [`.prose > hr + :is(h2, h3, h4, hr), .prose > hr + :where(${OBJECTS_BUT_TABLES})`]: FOLLOWER,
    '.prose > hr + .footnotes': FOLLOWER,
    [`.prose > :where(${OBJECTS}):has(+ .table-block)`]: BEFORE_TABLE,
    [`.prose > :where(${OBJECTS}) + h2`]: FOLLOWER,
    [`.prose > :where(${OBJECTS}) + h3`]: FOLLOWER,
    [`.prose > :where(${OBJECTS}) + h4`]: FOLLOWER,
    [`.prose > :where(${OBJECTS}) + hr`]: FOLLOWER,
    [`.prose > :where(${OBJECTS}) + :where(${OBJECTS_BUT_TABLES})`]: FOLLOWER,
    [`.prose > :is(${OBJECTS}) + .footnotes`]: FOLLOWER,
    '.prose > p:where(:first-child, .front-matter-node:first-child + p):has(+ h1)':
      'the eyebrow is a typographic role, the paragraph that opens the document straight before the title; only the first paragraph is asked',
    '.prose > p + h1': 'the title under its eyebrow; the subject is the title',
    '.prose p:has(> a.link-compact) + p:has(> a.link-compact)':
      'a run of compact links is a list of references (ADR-042), a role of its own, whose lines sit closer than paragraphs; only another compact link is asked',
    '.prose > h1 + p + p:has(> small:only-child)':
      'small print under the lede; only a paragraph holding nothing but `<small>` matches',
    '.prose > .details + .details, .prose .details-body > .details + .details':
      'a run of details shares its borders, which is a property of the pair; the subject is a details',
    '.prose > .details + .details':
      'a run of details sits at its own gap; the subject is a details',
    '.prose .details-body > .details + .details':
      'a run of details sits at its own gap; the subject is a details',
    '.prose .accordion > .details + .details':
      'an accordion’s details share their borders; the subject is a details',
    [`.prose .details-body > :where(${BODY_OBJECTS}, .details):has(+ .table-block)`]: BEFORE_TABLE,
    [`.prose .details-body > :where(${BODY_OBJECTS}, .details) + :where(${BODY_OBJECTS_BUT_TABLES})`]:
      FOLLOWER,
    '.prose > .details.callout + .details.callout':
      'folded callouts in a run sit closer; the subject is a details',
  },
  'table-editor.css': {
    [`${TABLE_ACTIVE}:has(+ .table-block)`]: `the toolbar's room comes on top of what the table leaves below it; ${BEFORE_TABLE}`,
  },
  'byline.css': {
    '.byline-verification-part + .byline-verification-part::before':
      'not rhythm: the dot between the parts of one byline sentence',
    '.byline-review-part + .byline-review-part::before':
      'not rhythm: the dot between the parts of one byline sentence',
    '.byline + .lifecycle-notice': BYLINE,
    '.prose > .byline + .lifecycle-notice': BYLINE,
    '.prose > h1 + :is(.byline, [data-byline-slot])': BYLINE,
    [`${BYLINES}:has(+ .table-block)`]: BYLINE,
    [`${BYLINES} + :where(h2, h3, h4, h5, h6, hr, ${OBJECTS_BUT_TABLES}), ${BYLINES} + .footnotes`]:
      BYLINE,
  },
  'public-site.css': {
    '.site-scheme input:hover + span':
      'not rhythm: a scheme choice’s label follows its radio; the public site’s stylesheet never reaches the editor',
    '.site-scheme input:checked + span':
      'not rhythm: a scheme choice’s label follows its radio; the public site’s stylesheet never reaches the editor',
    '.site-scheme input:focus-visible + span':
      'not rhythm: a scheme choice’s label follows its radio; the public site’s stylesheet never reaches the editor',
    '.prose > .site-eyebrow + *':
      'the collection’s eyebrow over the title exists only on the public site, whose stylesheet never reaches the editor',
  },
  'editor.css': {
    '.document-editor-content > .front-matter-node + *':
      'front matter is never drawn, so the first block after it starts the page; there is at most one, and it comes first',
  },
}

/**
 * Every `:has()` over content that is not a sibling relation, by file. These
 * ask about an element's own children or descendants, so they are re-asked
 * only when something inside that element changes; each is here so that a new
 * one, which might be asked of every block, is a decision rather than a drift.
 */
const HAS_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'prose.css': [
    '.table-block:has(> .table-scroll:focus-visible)',
    '.prose table:has(> colgroup)',
    '.prose .table-block table:has(> colgroup)',
    '.lightbox[open]:has(> .lightbox-stage-table)',
    '.lightbox:has(> .lightbox-stage-table) > .lightbox-controls',
    '.prose .badge[data-label]:has(> .emoji)::before',
    '.prose figure:has(> .diagram), .prose :not(figure) > .diagram',
    '.prose figure:has(> .diagram) figcaption',
    '.prose .cards:has(> .card:nth-child(4):last-child)',
    '.prose figure:has(> .diagram), .prose .diagram',
    ".prose .diagram[data-expandable='true']:has(svg)",
    ".prose figure:has(> .diagram[data-diagram='mermaid']:not([data-state='drawn'])) > .diagram-expand, .prose .diagram[data-diagram='mermaid']:not([data-state='drawn']) > .diagram-expand",
    '.prose .child-page:has(> .child-page-link .child-page-icon) > .child-page-excerpt',
  ],
  'layout.css': [
    ".layout-grid > figure:has(> .diagram[data-diagram='svg']), .layout-grid > :is(.table-block, .table-scroll)",
    ".layout-grid > .layout-wide, .layout-grid > .layout-full, .layout-grid > figure:has(> .diagram[data-diagram='svg']), .layout-grid > :is(.table-block, .table-scroll), .layout-grid > .table-block[data-width], .document-editor-content > [data-layout='wide'], .document-editor-content > [data-layout='full']",
    ".layout-grid > .layout-wide, .layout-grid > figure:has(> .diagram[data-diagram='svg']), .layout-grid > :is(.table-block, .table-scroll), .layout-grid > .table-block[data-width='wide'], .document-editor-content > [data-layout='wide']",
  ],
  'public-site.css': [
    '.site-header-inner:has(.site-compact) .site-compact',
    '.site-header-inner:has(.site-compact) .site-search',
    '.site-header-inner:has(.site-compact) .site-scheme',
    'body:has(.site-preview)',
  ],
  'editor.css': ['.code-block:has(.cm-focused)'],
  'table-editor.css': [
    '.table-block:has(> .table-editor[data-active]), .table-block.table-editor[data-active]',
    `${TABLE_ACTIVE}:where(:not(:last-child))`,
    ".table-block-editor:not([data-caption='bottom']):has(> p) > .table-editor > .table-handles",
  ],
}

/** Every rule's selector in a stylesheet, comments removed and whitespace collapsed. */
function selectors(css: string): readonly string[] {
  const bare = css.replaceAll(/\/\*[\s\S]*?\*\//gu, '')
  return [...bare.matchAll(/([^{};]+)\{/gu)]
    .map(([, prelude = '']) => prelude.replaceAll(/\s+/gu, ' ').trim())
    .filter(
      (prelude) =>
        prelude !== '' && !prelude.startsWith('@') && !/^[\d.]+%$|^(from|to)$/u.test(prelude),
    )
}

/** Whether a selector relates an element to its siblings: `+`, `~`, or `:has(+ …)`. */
function relatesSiblings(selector: string): boolean {
  const plain = selector
    .replaceAll(/\[[^\]]*\]/gu, '[]')
    .replaceAll(/'[^']*'|"[^"]*"/gu, '')
    .replaceAll(/:nth-[a-z-]+\([^)]*\)/gu, '')
  return /[+~]/u.test(plain)
}

/** The same selector however its lines were broken: spaces inside parentheses and around commas dropped. */
function normalise(selector: string): string {
  return selector
    .replaceAll(/\(\s+/gu, '(')
    .replaceAll(/\s+\)/gu, ')')
    .replaceAll(/\s*,\s*/gu, ', ')
}

describe('the reading rhythm', () => {
  for (const [name, path] of Object.entries(STYLESHEETS)) {
    const found = selectors(readFileSync(path, 'utf8')).filter(relatesSiblings).map(normalise)
    const allowed = Object.keys(ALLOWED[name] ?? {}).map(normalise)

    it(`adds no sibling relation to ${name} beyond the closed list`, () => {
      expect(found.filter((selector) => !allowed.includes(selector))).toEqual([])
    })

    it(`keeps no stale entry for ${name} in the closed list`, () => {
      expect(allowed.filter((selector) => !found.includes(selector))).toEqual([])
    })
  }

  for (const [name, path] of Object.entries(STYLESHEETS)) {
    it(`asks \`:has()\` of the content of ${name} only from the closed list`, () => {
      const found = selectors(readFileSync(path, 'utf8'))
        .filter((selector) => selector.includes(':has(') && !relatesSiblings(selector))
        .map(normalise)
      const allowed = (HAS_ALLOWED[name] ?? []).map(normalise)
      expect(found.filter((selector) => !allowed.includes(selector))).toEqual([])
      expect(allowed.filter((selector) => !found.includes(selector))).toEqual([])
    })
  }

  it('has no utility class that relates siblings', () => {
    // A Tailwind arbitrary variant that puts a sibling combinator in the selector (an "ampersand,
    // child, star, plus, star" margin utility, say) compiles to `.x > * + *`, which is re-checked
    // on every insertion anywhere on the page and, matching anything, restyles the whole editor
    // on each Enter. Writing the variant with `:where(:not(:first-child))` is the same rule. (Not
    // spelled out here: Tailwind reads this file too, and would generate the very class.)
    const root = here('../../../../')
    const sources = globSync(['packages/*/src/**/*.{ts,tsx}', 'apps/web/src/**/*.{ts,tsx}'], {
      cwd: root,
    })
    const variants = sources
      .filter((source) => !/\.test\.tsx?$/u.test(source))
      .flatMap((source) =>
        [
          ...readFileSync(`${root}/${source}`, 'utf8').matchAll(
            /\[&[^\]\s'"`]*[+~][^\]\s'"`]*\]/gu,
          ),
        ].map(([variant]) => `${source}: ${variant}`),
      )
    expect(variants).toEqual([])
  })

  it('has no rule whose subject is any block after a sibling', () => {
    // The shape that restyles the whole document: `X + *`, `* + X`, `X ~ *`.
    const universal = Object.entries(STYLESHEETS).flatMap(([name, path]) =>
      selectors(readFileSync(path, 'utf8'))
        .flatMap((rule) => rule.split(/,(?![^(]*\))/u).map((part) => part.trim()))
        .filter((part) => /[+~]\s*\*|\*\s*[+~]/u.test(part))
        .map((part) => `${name}: ${part}`),
    )
    expect(universal).toEqual([
      'public-site.css: .prose > .site-eyebrow + *',
      'editor.css: .document-editor-content > .front-matter-node + *',
    ])
  })
})
