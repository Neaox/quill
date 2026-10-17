/**
 * A number and the noun that goes with it: `1 block`, `2 blocks`.
 *
 * English is the interface's only language for now (`quill-plan.md`, open question 8), but
 * which form a number takes is a rule of the language, not of the count being one, so the
 * choice is made by the platform's own plural rules (`Intl.PluralRules`) rather than by
 * `=== 1`. Adding a language then adds forms to the call, and no logic. When the interface
 * is localised the strings move to the catalogue chosen then; this is the one place that
 * has to change.
 */

/** The forms a noun takes; `other` is required because every language has it. */
export interface NounForms {
  readonly zero?: string
  readonly one?: string
  readonly two?: string
  readonly few?: string
  readonly many?: string
  readonly other: string
}

export function counted(count: number, forms: NounForms, locale = 'en'): string {
  const form = forms[new Intl.PluralRules(locale).select(count)] ?? forms.other
  return `${new Intl.NumberFormat(locale).format(count)} ${form}`
}
