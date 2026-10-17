import type { Blockquote, Paragraph, PhrasingContent } from 'mdast'

import { alertOpening } from '../pipeline/github-alert.ts'

/**
 * A GitHub alert (`> [!WARNING]`) as the editor holds it.
 *
 * In Markdown an alert is a quote whose first line is a marker, and that is
 * what keeps it readable everywhere: every parser sees a quote. In the editor
 * the marker is not text the author should see or type over: the quote is drawn
 * as the callout the reader sees, so the marker line is lifted off the text
 * and carried on the quote as its `alert` attribute, as it was written — the
 * case of the word, and whether it was a paragraph of its own or the first
 * line of one. Writing the quote back puts that line back, so a document saved
 * unchanged is written back byte for byte, and changing the type changes the
 * word and nothing else: an alert stays an alert.
 */

/** GitHub's alert types. `info` is Quill's own, so only a `:::callout` can be one. */
export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const

export type AlertType = (typeof ALERT_TYPES)[number]

export function isAlertType(value: unknown): value is AlertType {
  return typeof value === 'string' && (ALERT_TYPES as readonly string[]).includes(value)
}

/** How an alert's marker was written. */
export interface AlertForm {
  /**
   * The marker as written, through the end of its line where the line went on
   * in the same paragraph: `[!NOTE]\n`, `[!note]`.
   */
  readonly marker: string
  /** The marker was a paragraph of its own, with a blank line after it. */
  readonly alone: boolean
}

const MARKER_WORD = /^\[!([a-z]+)\]/i

/** The type an alert's marker names. */
export function alertType(form: AlertForm): AlertType {
  const word = MARKER_WORD.exec(form.marker)?.[1]?.toLowerCase()
  return isAlertType(word) ? word : 'note'
}

/** The `alert` attribute, read back as a form, or undefined for an ordinary quote. */
export function alertForm(value: unknown): AlertForm | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const marker: unknown = Reflect.get(value, 'marker')
  const alone: unknown = Reflect.get(value, 'alone')
  if (typeof marker !== 'string' || typeof alone !== 'boolean') return undefined
  const word = MARKER_WORD.exec(marker)?.[1]?.toLowerCase()
  return isAlertType(word) ? { marker, alone } : undefined
}

/** The word written in the case the old one was: `NOTE`, `note`, or `Note`. */
function inCaseOf(written: string, type: AlertType): string {
  if (written === written.toUpperCase()) return type.toUpperCase()
  if (written === written.toLowerCase()) return type
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}`
}

/** The same marker naming another type: only the word changes. */
export function retypeAlert(form: AlertForm, type: AlertType): AlertForm {
  const marker = form.marker.replace(
    MARKER_WORD,
    (_whole, word: string) => `[!${inCaseOf(word, type)}]`,
  )
  return { ...form, marker }
}

/** An alert's body with the marker line taken off, and how the marker was written. */
export function readAlert(
  quote: Blockquote,
): { readonly form: AlertForm; readonly children: Blockquote['children'] } | undefined {
  const opening = alertOpening(quote)
  if (opening === undefined) return undefined
  const { paragraph, text, line } = opening
  const remainder = text.value.slice(line)
  const [, ...inline] = paragraph.children
  const rest: PhrasingContent[] =
    remainder.length === 0 ? inline : [{ ...text, value: remainder }, ...inline]
  const others = quote.children.slice(1)
  if (rest.length === 0) {
    return { form: { marker: text.value.slice(0, line), alone: true }, children: others }
  }
  return {
    form: { marker: text.value.slice(0, line), alone: false },
    children: [{ ...paragraph, children: rest }, ...others],
  }
}

/** A quote's children with the marker line put back in front of them. */
export function writeAlert<Child extends Blockquote['children'][number]>(
  children: readonly Child[],
  form: AlertForm,
): (Child | Paragraph)[] {
  const [first, ...rest] = children
  const own: Paragraph = {
    type: 'paragraph',
    children: [{ type: 'text', value: form.marker.trimEnd() }],
  }
  if (form.alone || first?.type !== 'paragraph' || first.children.length === 0) {
    const body = first?.type === 'paragraph' && first.children.length === 0 ? rest : children
    return [own, ...body]
  }
  const [lead, ...inline] = first.children
  // The marker's own line ending, or one of its own where the author's body
  // no longer opens with the hard break it was written with.
  const marker =
    form.marker.endsWith('\n') || lead?.type === 'break' ? form.marker : `${form.marker}\n`
  const opened: PhrasingContent[] =
    lead?.type === 'text'
      ? [{ ...lead, value: `${marker}${lead.value}` }, ...inline]
      : [{ type: 'text', value: marker }, ...first.children]
  return [{ ...first, children: opened }, ...rest]
}
