import { describe, expect, it } from 'vitest'

import {
  CODE_INDEX_ARTIFACT_VERSION,
  decodeCodeIndexArtifact,
  encodeCodeIndexArtifact,
  type CodeIndexArtifactV1,
} from './artifact.ts'

const artifact = (): CodeIndexArtifactV1 => ({
  formatVersion: CODE_INDEX_ARTIFACT_VERSION,
  tool: 'quill-code-index@0.0.0',
  commit: 'abc123',
  repo: 'quill/quill',
  generatedAt: '2026-11-12T12:00:00.000Z',
  files: {
    'packages/domain/src/b.ts': {
      path: 'packages/domain/src/b.ts',
      blob: 'b'.repeat(40),
      symbols: [
        {
          moniker: 'typescript:packages/domain:packages/domain/src/b.ts#zed',
          name: 'zed',
          kind: 'function',
          package: 'packages/domain',
          module: 'b',
          file: 'packages/domain/src/b.ts',
          visibility: 'exported',
          entryFile: true,
          signature: 'zed(): string',
          params: [],
          returnType: 'string',
          description: 'Zed.',
          tags: [],
          keywords: [],
          concepts: [],
          startLine: 1,
          endLine: 2,
          complexity: 1,
        },
        {
          moniker: 'typescript:packages/domain:packages/domain/src/b.ts#alpha',
          name: 'alpha',
          kind: 'const',
          package: 'packages/domain',
          module: 'b',
          file: 'packages/domain/src/b.ts',
          visibility: 'local',
          entryFile: false,
          signature: 'alpha: number',
          params: [],
          returnType: 'number',
          description: '',
          tags: [],
          keywords: [],
          concepts: [],
          startLine: 4,
          endLine: 4,
          complexity: null,
        },
      ],
      usages: [
        { to: 'typescript:packages/domain:packages/domain/src/a.ts#used', line: 8 },
        { to: 'typescript:packages/domain:packages/domain/src/a.ts#used', line: 2 },
      ],
      imports: ['packages/domain/src/a.ts'],
      reexports: [],
      signature: 'sig-b',
    },
    'packages/domain/src/a.ts': {
      path: 'packages/domain/src/a.ts',
      blob: 'a'.repeat(40),
      symbols: [],
      usages: [],
      imports: [],
      reexports: [],
      signature: 'sig-a',
    },
  },
})

describe('code-index artifact', () => {
  it('round-trips every field', () => {
    const encoded = encodeCodeIndexArtifact(artifact())
    const decoded = decodeCodeIndexArtifact(encoded)

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(encodeCodeIndexArtifact(decoded.value)).toBe(encodeCodeIndexArtifact(artifact()))
  })

  it('is byte-identical when the same corpus is encoded twice', () => {
    expect(encodeCodeIndexArtifact(artifact())).toBe(encodeCodeIndexArtifact(artifact()))
  })

  it('sorts files, symbols and usages so a reordered input has one representation', () => {
    const first = artifact()
    const second = artifact()
    const encoded = encodeCodeIndexArtifact(second)

    expect(encoded.indexOf('packages/domain/src/a.ts')).toBeLessThan(
      encoded.indexOf('packages/domain/src/b.ts'),
    )
    expect(encoded.indexOf('#alpha')).toBeLessThan(encoded.indexOf('#zed'))
    expect(encoded.indexOf('"line": 2')).toBeLessThan(encoded.indexOf('"line": 8'))
    expect(encodeCodeIndexArtifact(first)).toBe(encoded)
  })

  it('refuses an artifact from a newer format', () => {
    const encoded = encodeCodeIndexArtifact(artifact()).replace(
      `"formatVersion": ${String(CODE_INDEX_ARTIFACT_VERSION)}`,
      '"formatVersion": 999',
    )
    const decoded = decodeCodeIndexArtifact(encoded)

    expect(decoded).toMatchObject({ ok: false, error: { code: 'unsupported-version' } })
  })

  it('refuses a file record that is not keyed by its own path', () => {
    const encoded = encodeCodeIndexArtifact(artifact()).replace(
      '"path": "packages/domain/src/a.ts"',
      '"path": "packages/domain/src/wrong.ts"',
    )
    const decoded = decodeCodeIndexArtifact(encoded)

    expect(decoded).toMatchObject({ ok: false, error: { code: 'invalid-shape' } })
  })

  it('refuses text that is not JSON', () => {
    const decoded = decodeCodeIndexArtifact('not json')

    expect(decoded).toMatchObject({ ok: false, error: { code: 'not-json' } })
  })
})
