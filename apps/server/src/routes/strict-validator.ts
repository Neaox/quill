import { Ajv } from 'ajv'
import type { TSchema } from '@sinclair/typebox'
import type { FastifySchemaCompiler } from 'fastify'

/**
 * Ajv for the routes that set it, and only those.
 *
 * Fastify's default validator is built for forgiveness: it coerces `"1"` to
 * `1` and *removes* a property the schema does not declare rather than
 * refusing it. Neither is right for a document somebody chose: coercion would
 * let a policy arrive as the string `"false"` and be stored as a boolean
 * nobody chose, and silent removal would answer `200` to a request that asked
 * for something this release does not understand — the exact shape of a
 * client written against a newer version, which should be told rather than
 * quietly given a different result (`docs/security/checklist.md`: unknown
 * fields rejected).
 *
 * Set inside a route plugin, so it encapsulates: every other route keeps the
 * behaviour it was written against. `shared` are the schemas a body reaches
 * by `$ref`.
 */
export function strictValidator(shared: readonly TSchema[] = []): FastifySchemaCompiler<TSchema> {
  const ajv = new Ajv({
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    allErrors: false,
    strict: false,
  })
  for (const schema of shared) ajv.addSchema(schema)
  return ({ schema }) => ajv.compile(schema)
}
