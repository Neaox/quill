import { describe, expect, it } from 'vitest'

import { buildCodeIndex } from './build.ts'

const root = process.cwd()
const scope = 'packages/code-index/test/fixtures/zod'

describe('schema display adapters', () => {
  it('turns a Zod object into a readable shape and links its named output alias', () => {
    const artifact = buildCodeIndex({
      root,
      scopes: [scope],
      files: [`${scope}/src/schema.ts`],
      tool: 'test',
      generatedAt: '2026-11-12T12:00:00.000Z',
    })

    const file = artifact.files[`${scope}/src/schema.ts`]
    const constant = file?.symbols.find((symbol) => symbol.name === 'ACCOUNT_OPENING')
    const alias = file?.symbols.find((symbol) => symbol.name === 'AccountOpening')

    expect(constant?.readableType).toContain('open: boolean')
    expect(constant?.readableType).toContain('changedAt: string | null')
    expect(constant?.readableType).toContain('history: {')
    expect(constant?.inferredTypeRef).toMatchObject({ name: 'AccountOpening' })
    expect(alias?.schemaRef).toMatchObject({ name: 'ACCOUNT_OPENING' })
    expect(alias?.readableType).toBe(constant?.readableType)
  })
})
