import { Ajv } from 'ajv'
import * as ajvFormats from 'ajv-formats'
import type { ErrorObject } from 'ajv'
import type { FormatsPlugin } from 'ajv-formats'
import type { TSchema } from '@sinclair/typebox'

import { CoreFrontMatterSchema } from './core-schema.ts'

// `ajv-formats` is CommonJS whose `module.exports` is the plugin function itself,
// which the ES module type view can only describe as the module namespace. The
// interop is stated once here rather than at the call site.
const addFormats: FormatsPlugin = (ajvFormats as unknown as { default: FormatsPlugin }).default

export interface FrontMatterIssue {
  /** Dotted path to the offending value, such as `review.interval` or `owners[0]`. */
  readonly path: string
  readonly keyword: string
  readonly message: string
}

export interface FrontMatterValidation {
  readonly valid: boolean
  readonly issues: readonly FrontMatterIssue[]
}

export type FrontMatterValidator = (value: unknown) => FrontMatterValidation

/** Turns an ajv error into an issue an editor form can show against a field. */
export function toFrontMatterIssue(error: ErrorObject): FrontMatterIssue {
  return {
    path: toDottedPath(error.instancePath),
    keyword: error.keyword,
    message: error.message === undefined ? `fails ${error.keyword}` : error.message,
  }
}

function toDottedPath(instancePath: string): string {
  let path = ''
  for (const raw of instancePath.split('/')) {
    if (raw.length === 0) continue
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    if (/^\d+$/.test(segment)) path += `[${segment}]`
    else if (path.length === 0) path = segment
    else path += `.${segment}`
  }
  return path
}

/**
 * Compiles a schema into a validator that reports rather than throws. Validation
 * warns and never discards (ADR-005): an invalid field is still a field, and the
 * document still opens.
 */
export function createFrontMatterValidator(schema: TSchema): FrontMatterValidator {
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })
  addFormats(ajv)
  const validate = ajv.compile(schema)

  return (value: unknown): FrontMatterValidation => {
    const valid = validate(value)
    const errors = validate.errors ?? []
    return { valid, issues: errors.map(toFrontMatterIssue) }
  }
}

/** The core schema's validator, compiled once. */
export const validateFrontMatter: FrontMatterValidator =
  createFrontMatterValidator(CoreFrontMatterSchema)
