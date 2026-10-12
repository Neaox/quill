import { useState, type ChangeEvent } from 'react'

import { isValidationError } from './describe-error.ts'
import { validateWith, type StandardSchemaV1 } from './standard-schema.ts'
import { fieldErrorsFrom } from './validation.ts'

interface Problems {
  readonly fields: Readonly<Record<string, string>>
  /** What the schema said that belongs to no single field. */
  readonly rest: readonly string[]
}

const NO_PROBLEMS: Problems = { fields: {}, rest: [] }

export interface FormValidation<Output> {
  /** The message to show on each field that has one, keyed by field name. */
  readonly errors: Readonly<Record<string, string>>
  /**
   * Runs the schema over the form's values and shows what is wrong. Resolves
   * to the schema's output when all is well. Otherwise it resolves to
   * `undefined`, with focus on the first field with a problem, and the form is
   * not to be submitted.
   */
  validate(
    values: Readonly<Record<string, string>>,
    form: HTMLFormElement,
  ): Promise<Output | undefined>
  /**
   * For the form's `onChange`: forgets the message on the field being edited,
   * which is no longer about the value in it.
   */
  clearOnChange(event: ChangeEvent<HTMLFormElement>): void
  /**
   * Shows the messages the server gave for fields this form has. Fields the
   * form lacks are ignored, so a complaint is never hidden on an input that
   * is not there.
   */
  adopt(error: unknown, form: HTMLFormElement): void
  /**
   * What to show above the button: the submission's error, unless the server's
   * complaint is already on the fields, where saying it twice would be
   * announced twice — or, with no error, whatever the schema said about the
   * form as a whole.
   */
  formLevel(error: unknown): unknown
}

/**
 * Field validation for a form that submits itself (`noValidate`).
 *
 * It takes a Standard Schema (https://standard-schema.dev), so the rules are
 * whatever the form's author reaches for — Zod, Valibot, ArkType, or the
 * plain `schemaFromRules` — and this knows none of them. The browser's own
 * bubbles are unstyled, announced inconsistently, and offer little beyond
 * "required".
 *
 * A message is cleared when its field is edited and comes back only when the
 * form is next submitted, so a person is not told they are wrong while they
 * are still typing the answer.
 */
export function useFormValidation<Output>(
  schema: StandardSchemaV1<unknown, Output>,
): FormValidation<Output> {
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS)

  return {
    errors: problems.fields,

    async validate(values, form) {
      const result = await validateWith(schema, values)
      if (result.ok) {
        setProblems(NO_PROBLEMS)
        return result.value
      }
      setProblems({ fields: result.fields, rest: result.rest })

      const first = Object.keys(result.fields)[0]
      const control = first === undefined ? null : form.elements.namedItem(first)
      if (control instanceof HTMLElement) control.focus()
      return undefined
    },

    clearOnChange(event) {
      const { name } = event.target
      setProblems((current) => ({
        ...current,
        fields: Object.fromEntries(
          Object.entries(current.fields).filter(([field]) => field !== name),
        ),
      }))
    },

    adopt(error, form) {
      const known = Object.entries(fieldErrorsFrom(error)).filter(
        ([field]) => form.elements.namedItem(field) !== null,
      )
      setProblems((current) => ({
        ...current,
        fields: { ...current.fields, ...Object.fromEntries(known) },
      }))
    },

    formLevel(error) {
      const onFields = isValidationError(error) && Object.keys(problems.fields).length > 0
      const shown = onFields || error === undefined || error === null ? undefined : error
      return shown ?? (problems.rest.length === 0 ? undefined : problems.rest.join(' '))
    },
  }
}
