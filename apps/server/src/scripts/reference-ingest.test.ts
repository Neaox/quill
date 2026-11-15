import { beforeEach, describe, expect, it } from 'vitest'
import {
  createFakeClock,
  createFakeIdGenerator,
  createInMemoryBlobStore,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import type { InMemoryUnitOfWork } from '@quill/application/test-support'
import { workspaceId } from '@quill/domain'
import type { WorkspaceId } from '@quill/domain'

import { ingestReferenceFile, summariseReference } from './reference-ingest.ts'
import type { ReferenceDependencies } from '@quill/application'

const NOW = new Date('2026-11-14T10:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER = workspaceId('00000000-0000-4000-8000-000000000102')
const encoder = new TextEncoder()

function codeArtifact(): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      formatVersion: 1,
      tool: 'quill-code-index',
      commit: 'abc1234',
      repo: 'example/repo',
      generatedAt: '2026-11-14T09:00:00.000Z',
      files: {
        'a.ts': {
          path: 'a.ts',
          blob: 'a'.repeat(40),
          symbols: [
            {
              moniker: 'typescript:example:a.ts#one',
              name: 'one',
              kind: 'function',
              package: 'example',
              module: 'a',
              file: 'a.ts',
              visibility: 'exported',
              entryFile: true,
              signature: 'one(): void',
              params: [],
              returnType: 'void',
              description: '',
              tags: [],
              keywords: [],
              concepts: [],
              startLine: 1,
              endLine: 1,
              complexity: 0,
            },
            {
              moniker: 'typescript:example:a.ts#two',
              name: 'two',
              kind: 'const',
              package: 'example',
              module: 'a',
              file: 'a.ts',
              visibility: 'exported',
              entryFile: true,
              signature: 'two: 2',
              params: [],
              returnType: '2',
              description: '',
              tags: [],
              keywords: [],
              concepts: [],
              startLine: 2,
              endLine: 2,
              complexity: 0,
            },
          ],
          usages: [],
          imports: [],
          reexports: [],
          signature: 'sig',
        },
      },
    }),
  )
}

function schemaArtifact(): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      formatVersion: 1,
      dialect: 'postgres',
      database: 'app',
      source: 'catalog',
      capturedAt: '2026-11-14T09:00:00.000Z',
      tables: [
        {
          schema: 'public',
          name: 'accounts',
          kind: 'table',
          columns: [],
          primaryKey: [],
          unique: [],
          foreignKeys: [],
        },
        {
          schema: 'public',
          name: 'owners',
          kind: 'table',
          columns: [],
          primaryKey: [],
          unique: [],
          foreignKeys: [],
        },
      ],
    }),
  )
}

let uow: InMemoryUnitOfWork
let deps: ReferenceDependencies

async function seedWorkspace(id: WorkspaceId, slug: string): Promise<void> {
  await uow.repos.workspaces.create({ id, unitId: 'unit-1', name: slug, slug, now: NOW })
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  deps = {
    uow,
    blobStore: createInMemoryBlobStore(),
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
  }
  await uow.repos.units.create({
    id: 'unit-1',
    parentId: null,
    name: 'Engineering',
    slug: 'engineering',
    label: 'unit',
    now: NOW,
  })
  await seedWorkspace(WORKSPACE, 'engineering')
})

describe('summariseReference', () => {
  it('reads a code artifact’s version, capture time and symbol count', () => {
    expect(summariseReference('code', codeArtifact())).toEqual({
      artifactVersion: 1,
      capturedAt: new Date('2026-11-14T09:00:00.000Z'),
      symbolCount: 2,
      tableCount: 0,
    })
  })

  it('reads a schema artifact’s table count', () => {
    expect(summariseReference('schema', schemaArtifact())).toEqual({
      artifactVersion: 1,
      capturedAt: new Date('2026-11-14T09:00:00.000Z'),
      symbolCount: 0,
      tableCount: 2,
    })
  })

  it('refuses a schema artifact read as code, and the reverse', () => {
    expect(() => summariseReference('code', schemaArtifact())).toThrow('not readable')
    expect(() => summariseReference('schema', codeArtifact())).toThrow('needs a capture time')
  })

  it('refuses a schema artifact that is not JSON', () => {
    expect(() => summariseReference('schema', encoder.encode('{'))).toThrow('not JSON')
  })

  it('refuses a schema artifact that is not an object', () => {
    expect(() => summariseReference('schema', encoder.encode('[]'))).toThrow(
      'artifact is not an object',
    )
  })

  it('refuses an unsupported schema format version', () => {
    const value = JSON.parse(new TextDecoder().decode(schemaArtifact())) as Record<string, unknown>
    value['formatVersion'] = 2
    expect(() => summariseReference('schema', encoder.encode(JSON.stringify(value)))).toThrow(
      'supports schema format 1',
    )
  })

  it('refuses a schema artifact with no capture time or table list', () => {
    const value = JSON.parse(new TextDecoder().decode(schemaArtifact())) as Record<string, unknown>
    value['tables'] = 'none'
    expect(() => summariseReference('schema', encoder.encode(JSON.stringify(value)))).toThrow(
      'capture time and a table list',
    )
  })

  it('refuses a table that is not an object', () => {
    const value = JSON.parse(new TextDecoder().decode(schemaArtifact())) as Record<string, unknown>
    value['tables'] = [1]
    expect(() => summariseReference('schema', encoder.encode(JSON.stringify(value)))).toThrow(
      'has a table that is not an object',
    )
  })

  it('refuses an artifact with no valid capture time', () => {
    const artifact = JSON.parse(new TextDecoder().decode(codeArtifact())) as Record<string, unknown>
    artifact['generatedAt'] = 'yesterday'
    expect(() => summariseReference('code', encoder.encode(JSON.stringify(artifact)))).toThrow(
      'not a date',
    )
  })
})

describe('ingestReferenceFile', () => {
  it('stores a code artifact with the provenance the artifact carries', async () => {
    const result = await ingestReferenceFile(deps, {
      workspaceId: WORKSPACE,
      kind: 'code',
      sourceCommit: 'abc1234',
      artifact: codeArtifact(),
    })

    expect(result.kind).toBe('stored')
    if (result.kind !== 'stored') return
    expect(result.snapshot).toMatchObject({
      kind: 'code',
      sourceCommit: 'abc1234',
      capturedAt: new Date('2026-11-14T09:00:00.000Z'),
      artifactVersion: 1,
      symbolCount: 2,
      tableCount: 0,
    })
    expect(result.snapshot.artifactSize).toBe(codeArtifact().length)
  })

  it('stores a schema artifact with its table count', async () => {
    const result = await ingestReferenceFile(deps, {
      workspaceId: WORKSPACE,
      kind: 'schema',
      sourceCommit: 'abc1234',
      artifact: schemaArtifact(),
    })

    if (result.kind !== 'stored') throw new Error('not stored')
    expect(result.snapshot).toMatchObject({ kind: 'schema', tableCount: 2 })
  })

  it('lets the caller override the capture time', async () => {
    const result = await ingestReferenceFile(deps, {
      workspaceId: WORKSPACE,
      kind: 'code',
      sourceCommit: 'abc1234',
      artifact: codeArtifact(),
      capturedAt: new Date('2026-11-14T09:30:00.000Z'),
    })

    if (result.kind !== 'stored') throw new Error('not stored')
    expect(result.snapshot.capturedAt).toEqual(new Date('2026-11-14T09:30:00.000Z'))
  })

  it('refuses an unknown workspace', async () => {
    const result = await ingestReferenceFile(deps, {
      workspaceId: OTHER,
      kind: 'code',
      sourceCommit: 'abc1234',
      artifact: codeArtifact(),
    })

    expect(result).toEqual({ kind: 'workspace-not-found', workspaceId: OTHER })
  })
})
