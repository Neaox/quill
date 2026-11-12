import { describe, expect, it } from 'vitest'

import { decodeCodeIndexArtifact, encodeCodeIndexArtifact } from '../artifact.ts'
import { buildCodeIndex } from './build.ts'

const root = process.cwd()

describe('TypeScript extractor', () => {
  it('reads a real Quill module into the artifact', () => {
    const artifact = buildCodeIndex({
      root,
      scopes: ['packages/domain'],
      files: ['packages/domain/src/result.ts'],
      tool: 'test',
      generatedAt: '2026-11-12T12:00:00.000Z',
    })

    const file = artifact.files['packages/domain/src/result.ts']
    expect(file).toBeDefined()
    const names = file?.symbols.map((symbol) => symbol.name) ?? []
    expect(names).toContain('Result')
    expect(names).toContain('ok')
    expect(names).toContain('err')
    expect(
      file?.symbols.every((symbol) => symbol.moniker.startsWith('typescript:@quill/domain:')),
    ).toBe(true)

    const decoded = decodeCodeIndexArtifact(encodeCodeIndexArtifact(artifact))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.files['packages/domain/src/result.ts']?.symbols).toHaveLength(
      file?.symbols.length ?? 0,
    )
  })
})
