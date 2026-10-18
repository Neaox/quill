import type { SourceForm } from './source-form.ts'
import { attributesRead } from './source-form.ts'

/**
 * Changing one attribute of a directive without rewriting how the rest of its
 * attribute block was written (ADR-002, `source-form.ts`).
 *
 * The writer keeps a directive's attribute block as written only while the
 * attributes are the ones it was read as; change any of them and the whole
 * block is written in the canonical spelling. That is right for an edit the
 * editor cannot see the shape of, and wrong for one it can: switching a
 * callout from `{type=warning}` to caution should change one word. This
 * rewrites the value in the block as written — quoted as it was, or bare —
 * and records the new attributes as what it now reads as, so the block is
 * still written as the author wrote it.
 */

export interface WithAttribute {
  readonly attributes: Readonly<Record<string, string>>
  readonly sourceForm: SourceForm | null
}

/** A value that can be written bare in an attribute block. */
const BARE = /^[^\s"'=<>`}]+$/

function escapeName(name: string): string {
  return name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function withAttribute(
  attributes: Readonly<Record<string, string>>,
  sourceForm: SourceForm | null,
  name: string,
  value: string,
): WithAttribute {
  const next = { ...attributes, [name]: value }
  const written = sourceForm?.attributes?.written
  if (sourceForm === null || written === undefined) return { attributes: next, sourceForm }
  const pattern = new RegExp(`(^|[\\s{])(${escapeName(name)}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s}]+)`)
  const match = pattern.exec(written)
  const { attributes: _dropped, ...rest } = sourceForm
  const canonical = Object.keys(rest).length === 0 ? null : rest
  if (match === null) return { attributes: next, sourceForm: canonical }
  const [, lead = '', assign = '', old = ''] = match
  const quote = old.startsWith('"') || old.startsWith("'") ? old.charAt(0) : ''
  if (quote === '' && !BARE.test(value)) return { attributes: next, sourceForm: canonical }
  if (quote !== '' && value.includes(quote)) return { attributes: next, sourceForm: canonical }
  const rewritten =
    written.slice(0, match.index) +
    `${lead}${assign}${quote}${value}${quote}` +
    written.slice(match.index + match[0].length)
  return {
    attributes: next,
    sourceForm: { ...sourceForm, attributes: { written: rewritten, read: attributesRead(next) } },
  }
}
