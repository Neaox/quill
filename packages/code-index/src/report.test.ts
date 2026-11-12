import { describe, expect, it } from 'vitest'

import {
  CODE_INDEX_ARTIFACT_VERSION,
  type CodeIndexArtifactV1,
  type SchemaSnapshotV1,
} from './index.ts'
import { buildCodeIndexReport } from './report.ts'

const artifact: CodeIndexArtifactV1 = {
  formatVersion: CODE_INDEX_ARTIFACT_VERSION,
  tool: 'test',
  commit: 'a1b2c3d4e5f6',
  repo: 'example/repo',
  generatedAt: '2026-11-12T12:00:00.000Z',
  files: {
    'packages/payments/src/service.ts': {
      path: 'packages/payments/src/service.ts',
      blob: 'a'.repeat(40),
      symbols: [
        {
          moniker: 'typescript:@example/payments:packages/payments/src/service.ts#capture',
          name: 'capture',
          kind: 'function',
          package: 'packages/payments',
          module: 'service',
          file: 'packages/payments/src/service.ts',
          visibility: 'exported',
          entryFile: true,
          signature: 'capture(input: CaptureInput): Promise<CaptureResult>',
          params: [{ name: 'input', type: 'CaptureInput', optional: false }],
          returnType: 'Promise<CaptureResult>',
          description: 'Captures a payment and closes its nights.',
          tags: [],
          keywords: ['payment'],
          concepts: ['payments'],
          startLine: 10,
          endLine: 20,
          complexity: 2,
        },
      ],
      usages: [],
      imports: [],
      reexports: [],
      signature: 'sig',
    },
  },
}

const schema: SchemaSnapshotV1 = {
  formatVersion: 1,
  dialect: 'postgres',
  database: 'payments',
  source: 'migrations',
  capturedAt: '2026-11-12T12:00:00.000Z',
  tables: [
    {
      schema: 'payments',
      name: 'intents',
      kind: 'table',
      columns: [
        {
          name: 'id',
          type: 'uuid',
          nullable: false,
          ordinal: 1,
          primaryKey: true,
          unique: false,
        },
        {
          name: 'status',
          type: 'text',
          nullable: false,
          default: "'created'",
          ordinal: 2,
          primaryKey: false,
          unique: false,
        },
      ],
      primaryKey: ['id'],
      unique: [],
      foreignKeys: [],
    },
  ],
}

describe('code and schema report', () => {
  it('renders code, schema and their provenance into one page', () => {
    const html = buildCodeIndexReport({ artifact, schema, title: 'Payments' })

    expect(html).toContain('Payments')
    expect(html).toContain('capture')
    expect(html).toContain('intents')
    expect(html).toContain('a1b2c3d4e')
    expect(html).toContain('No row values are read')
  })

  it('escapes a closing script tag in embedded data', () => {
    const dangerous = {
      ...artifact,
      files: {
        ...artifact.files,
        'packages/payments/src/bad.ts': {
          ...artifact.files['packages/payments/src/service.ts']!,
          path: 'packages/payments/src/bad.ts',
          symbols: [
            {
              ...artifact.files['packages/payments/src/service.ts']!.symbols[0]!,
              name: '</script><script>alert(1)</script>',
              description: '</script>',
            },
          ],
        },
      },
    }
    const html = buildCodeIndexReport({ artifact: dangerous })

    expect(html).not.toContain('</script><script>alert(1)</script>')
    expect(html).toContain('\\u003c/script>')
  })

  it('says when no schema was supplied', () => {
    const html = buildCodeIndexReport({ artifact })

    expect(html).toContain('No schema was supplied to this report.')
  })
})
