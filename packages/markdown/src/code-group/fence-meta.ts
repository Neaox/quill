/**
 * What a fence's meta string — everything after the language on the opening
 * line — says about the block, in the syntaxes other documentation platforms
 * already write (ADR-041):
 *
 * - a **tab label** as VitePress writes it, ```` ```ts [TypeScript] ````, or
 *   as Fumadocs writes it, ```` ```ts tab="TypeScript" ````;
 * - a **title**, the file the code belongs in, as Docusaurus, Fumadocs and
 *   Expressive Code write it: ```` ```ts title="src/app.ts" ````.
 *
 * The meta string is the document's. Anything else in it (line highlights,
 * `{1,3}`, `showLineNumbers`) is kept exactly as written, and a rename changes
 * only the label, in the syntax it was written in.
 */

const BRACKET = /\[([^\]\n]*)\]/u
const TAB = /(^|\s)tab=(?:"([^"\n]*)"|'([^'\n]*)')/u
const TITLE = /(^|\s)title=(?:"([^"\n]*)"|'([^'\n]*)')/u

/** How a new label is written where the meta has none yet. */
export type TabLabelSyntax = 'bracket' | 'attribute'

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

function quoted(meta: string | null | undefined, pattern: RegExp): string | undefined {
  const match = pattern.exec(meta ?? '')
  return nonEmpty(match?.[2] ?? match?.[3])
}

/** The tab label a fence carries, in either syntax. */
export function tabLabel(meta: string | null | undefined): string | undefined {
  return quoted(meta, TAB) ?? nonEmpty(BRACKET.exec(meta ?? '')?.[1])
}

/** The file a fence's code belongs in. */
export function fenceTitle(meta: string | null | undefined): string | undefined {
  return quoted(meta, TITLE)
}

/** Whether a fence is a Fumadocs tab: one of a run of fences grouped by `tab="…"`. */
export function hasTabAttribute(meta: string | null | undefined): boolean {
  return TAB.test(meta ?? '')
}

/** A label reduced to what its syntax can hold: one line, no bracket or quote to close it early. */
function writable(label: string): string {
  return label.replaceAll(/[\]["'\n\r]/gu, '').trim()
}

/**
 * The meta with its tab label set to `label`: replaced where it was written,
 * added in `syntax` where it was not, and removed when the label is empty.
 * Null when nothing is left, which is how an absent meta is written.
 */
export function withTabLabel(
  meta: string | null | undefined,
  label: string,
  syntax: TabLabelSyntax,
): string | null {
  const value = writable(label)
  const current = meta ?? ''
  let next: string
  if (TAB.test(current)) {
    next = current.replace(TAB, value.length === 0 ? '$1' : `$1tab="${value}"`)
  } else if (BRACKET.test(current)) {
    next = current.replace(BRACKET, value.length === 0 ? '' : `[${value}]`)
  } else if (value.length === 0) {
    next = current
  } else {
    const written = syntax === 'attribute' ? `tab="${value}"` : `[${value}]`
    next =
      current.length === 0
        ? written
        : syntax === 'attribute'
          ? `${current} ${written}`
          : `${written} ${current}`
  }
  const tidy = next.replaceAll(/\s{2,}/gu, ' ').trim()
  return tidy.length === 0 ? null : tidy
}
