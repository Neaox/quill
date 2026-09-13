import { describe, expect, it } from 'vitest'

import type { DrizzleClient } from '../db/types.ts'
import { isProgramLimitExceeded, probeTrigram } from './postgres-search-index.ts'

/**
 * The one thing about the adapter that is not about SQL: whether this
 * database can answer a trigram question at all (ADR-010's typo tolerance
 * degrades rather than failing when `pg_trgm` cannot be installed).
 */

function database(execute: () => Promise<unknown>): DrizzleClient {
  return { execute } as unknown as DrizzleClient
}

describe('probing for pg_trgm', () => {
  it('is available when the operator answers', async () => {
    expect(await probeTrigram(database(async () => ({ rows: [] })))).toBe(true)
  })

  it('is unavailable when it does not, rather than failing the search', async () => {
    expect(
      await probeTrigram(
        database(async () => {
          throw new Error('function similarity(text, text) does not exist')
        }),
      ),
    ).toBe(false)
  })
})

describe('recognising the refusal a too-large tsvector produces', () => {
  it('finds the SQLSTATE the driver put on the error', () => {
    expect(isProgramLimitExceeded({ code: '54000' })).toBe(true)
  })

  it('finds it under the wrapper the query builder adds', () => {
    expect(isProgramLimitExceeded(new Error('failed query', { cause: { code: '54000' } }))).toBe(
      true,
    )
  })

  it.each([
    ['a different refusal', { code: '23505' }],
    ['nothing that carries a SQLSTATE at all', new Error('the pool is closed')],
    ['not an error object', 'a string'],
  ])('says no to %s', (_description, error) => {
    expect(isProgramLimitExceeded(error)).toBe(false)
  })

  it('gives up on a cause chain that never ends, rather than following it for ever', () => {
    const looping: { cause?: unknown } = {}
    looping.cause = looping
    expect(isProgramLimitExceeded(looping)).toBe(false)
  })
})
