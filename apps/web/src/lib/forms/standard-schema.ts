import { BRAND } from '@quill/brand'

import type { FieldRule } from './validation.ts'

/**
 * The Standard Schema interface (https://standard-schema.dev), copied rather
 * than imported: the specification is a handful of types, it asks
 * implementers to copy them, and a package for them would be a dependency
 * that holds no code. Zod 4, Valibot, ArkType and the rest implement it, so a
 * form that is written against these types takes any of them without knowing
 * which. The names are flat rather than the specification's `StandardSchemaV1`
 * namespace, which this project's erasable-syntax rule does not allow.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1Props<Input, Output>
}

export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  readonly version: 1
  readonly vendor: string
  readonly validate: (
    value: unknown,
  ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>
  readonly types?: { readonly input: Input; readonly output: Output } | undefined
}

export type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaV1Issue[] }

export interface StandardSchemaV1Issue {
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined
}

/** What a validation says: the schema's output, or where each problem goes. */
export type Validation<Output> =
  | { readonly ok: true; readonly value: Output }
  | {
      readonly ok: false
      readonly fields: Readonly<Record<string, string>>
      readonly rest: readonly string[]
    }

function stepName(step: PropertyKey | { readonly key: PropertyKey }): string {
  return String(typeof step === 'object' ? step.key : step)
}

/**
 * Sorts a schema's problems into one message per field — the first, because a
 * person fixes one thing at a time — keyed by the first step of the path, and
 * the messages that belong to no single field (a rule across several). The
 * latter are returned rather than dropped, so a form that cannot be submitted
 * is never silent about why.
 */
export function fieldErrorsFromIssues(issues: readonly StandardSchemaV1Issue[]): {
  readonly fields: Readonly<Record<string, string>>
  readonly rest: readonly string[]
} {
  const fields: Record<string, string> = {}
  const rest: string[] = []
  for (const { message, path } of issues) {
    const first = path?.[0]
    if (first === undefined) rest.push(message)
    else fields[stepName(first)] ??= message
  }
  return { fields, rest }
}

/** Runs a schema over a form's values, whether it answers now or later. */
export async function validateWith<Output>(
  schema: StandardSchemaV1<unknown, Output>,
  values: unknown,
): Promise<Validation<Output>> {
  const result = await schema['~standard'].validate(values)
  if (result.issues === undefined) return { ok: true, value: result.value }
  return { ok: false, ...fieldErrorsFromIssues(result.issues) }
}

type FormValues = Readonly<Record<string, string>>

/**
 * A schema made of one rule per field, for the forms whose rules are a line
 * each and would gain nothing from a library. It is a Standard Schema like any
 * other, so replacing it with a Zod or Valibot object later changes the schema
 * and nothing around it.
 */
export function schemaFromRules(
  rules: Readonly<Record<string, FieldRule>>,
): StandardSchemaV1<unknown, FormValues> {
  return {
    '~standard': {
      version: 1,
      vendor: BRAND.slug,
      validate(value) {
        if (typeof value !== 'object' || value === null) {
          return { issues: [{ message: 'Expected the form’s values.' }] }
        }
        const values: Record<string, string> = {}
        const issues: StandardSchemaV1Issue[] = []
        for (const [field, rule] of Object.entries(rules)) {
          const raw: unknown = Reflect.get(value, field)
          const text = typeof raw === 'string' ? raw : ''
          values[field] = text
          const message = rule(text)
          if (message !== undefined) issues.push({ message, path: [field] })
        }
        return issues.length === 0 ? { value: values } : { issues }
      },
    },
  }
}
