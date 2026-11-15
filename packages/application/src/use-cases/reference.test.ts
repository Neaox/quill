import { beforeEach, describe, expect, it } from 'vitest'
import { workspaceId } from '@quill/domain'
import type { WorkspaceId } from '@quill/domain'

import { readBlob } from '../ports/blob-store.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryBlobStore } from '../test-support/in-memory-blob-store.ts'
import type { InMemoryBlobStore } from '../test-support/in-memory-blob-store.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import {
  ingestReference,
  latestReference,
  listReferenceSnapshots,
  openReferenceArtifact,
} from './reference.ts'
import type { IngestReferenceCommand, ReferenceDependencies } from './reference.ts'

const NOW = new Date('2026-11-14T10:00:00.000Z')
const CAPTURED = new Date('2026-11-14T09:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER = workspaceId('00000000-0000-4000-8000-000000000102')

async function* text(value: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(value)
}

let uow: InMemoryUnitOfWork
let blobStore: InMemoryBlobStore
let clock: ReturnType<typeof createFakeClock>
let deps: ReferenceDependencies

async function seedWorkspace(id: WorkspaceId, slug: string): Promise<void> {
  await uow.repos.workspaces.create({
    id,
    unitId: 'unit-1',
    name: slug,
    slug,
    now: NOW,
  })
}

function command(overrides: Partial<IngestReferenceCommand> = {}): IngestReferenceCommand {
  return {
    workspaceId: WORKSPACE,
    kind: 'code',
    sourceCommit: 'abc1234',
    capturedAt: CAPTURED,
    artifactVersion: 1,
    symbolCount: 18_409,
    tableCount: 0,
    artifact: text('{"formatVersion":1,"files":{}}'),
    ...overrides,
  }
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  blobStore = createInMemoryBlobStore()
  clock = createFakeClock(NOW)
  deps = {
    uow,
    blobStore,
    clock,
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

describe('ingestReference', () => {
  it('stores the artifact and the provenance, and serves the latest', async () => {
    const result = await ingestReference(deps, command())

    expect(result.kind).toBe('stored')
    if (result.kind !== 'stored') return
    expect(result.snapshot).toMatchObject({
      workspaceId: WORKSPACE,
      kind: 'code',
      sourceCommit: 'abc1234',
      capturedAt: CAPTURED,
      artifactVersion: 1,
      symbolCount: 18_409,
      tableCount: 0,
      createdAt: NOW,
    })
    expect(result.snapshot.artifactSize).toBeGreaterThan(0)
    expect(await blobStore.has(result.snapshot.artifactHash)).toBe(true)

    expect(await uow.repos.referenceSnapshots.findById(result.snapshot.id)).toEqual(result.snapshot)
    expect(await uow.repos.referenceSnapshots.findById('missing')).toBeNull()

    const latest = await latestReference(deps, WORKSPACE, 'code')
    expect(latest?.id).toBe(result.snapshot.id)
    expect(await latestReference(deps, WORKSPACE, 'schema')).toBeNull()
    expect(await latestReference(deps, OTHER, 'code')).toBeNull()
  })

  it('keeps identical bytes in one object across two snapshots', async () => {
    const first = await ingestReference(deps, command())
    const second = await ingestReference(
      deps,
      command({ capturedAt: new Date('2026-11-14T09:30:00.000Z') }),
    )
    if (first.kind !== 'stored' || second.kind !== 'stored') throw new Error('not stored')

    expect(first.snapshot.artifactHash).toBe(second.snapshot.artifactHash)
    expect(first.snapshot.id).not.toBe(second.snapshot.id)
  })

  it('stores a schema artifact with its table count', async () => {
    const result = await ingestReference(
      deps,
      command({
        kind: 'schema',
        artifactVersion: 1,
        symbolCount: 0,
        tableCount: 207,
        artifact: text('{"formatVersion":1,"tables":[]}'),
      }),
    )
    if (result.kind !== 'stored') throw new Error('not stored')
    expect(result.snapshot).toMatchObject({ kind: 'schema', tableCount: 207, symbolCount: 0 })
  })

  it('refuses an unknown workspace and stores nothing', async () => {
    const result = await ingestReference(deps, command({ workspaceId: OTHER }))

    expect(result).toEqual({ kind: 'workspace-not-found', workspaceId: OTHER })
    expect(await latestReference(deps, OTHER, 'code')).toBeNull()
  })

  it('refuses an empty commit, an invalid date, and a bad version', async () => {
    await expect(ingestReference(deps, command({ sourceCommit: '  ' }))).rejects.toThrow(
      'needs the commit',
    )
    await expect(
      ingestReference(deps, command({ capturedAt: new Date('not a date') })),
    ).rejects.toThrow('valid capture time')
    await expect(ingestReference(deps, command({ artifactVersion: 0 }))).rejects.toThrow(
      'positive integer',
    )
    await expect(ingestReference(deps, command({ symbolCount: -1 }))).rejects.toThrow(
      'non-negative integer',
    )
  })
})

describe('listReferenceSnapshots', () => {
  it('answers newest first and bounds the limit', async () => {
    const older = await ingestReference(
      deps,
      command({ capturedAt: new Date('2026-11-14T08:00:00.000Z') }),
    )
    const newer = await ingestReference(
      deps,
      command({ capturedAt: new Date('2026-11-14T09:00:00.000Z') }),
    )
    if (older.kind !== 'stored' || newer.kind !== 'stored') throw new Error('not stored')

    const list = await listReferenceSnapshots(deps, WORKSPACE, 'code', 10)
    expect(list.map((row) => row.id)).toEqual([newer.snapshot.id, older.snapshot.id])
    expect(await listReferenceSnapshots(deps, WORKSPACE, 'code', 0)).toHaveLength(1)
    expect(await listReferenceSnapshots(deps, WORKSPACE, 'code', 1_000)).toHaveLength(2)
  })
})

describe('snapshots of one capture time', () => {
  it('orders them by when they were written, newest first', async () => {
    const first = await ingestReference(deps, command())
    clock.advance(1_000)
    const second = await ingestReference(deps, command())
    if (first.kind !== 'stored' || second.kind !== 'stored') throw new Error('not stored')

    expect(first.snapshot.capturedAt).toEqual(second.snapshot.capturedAt)
    const list = await listReferenceSnapshots(deps, WORKSPACE, 'code', 10)
    expect(list.map((row) => row.id)).toEqual([second.snapshot.id, first.snapshot.id])
  })
})

describe('openReferenceArtifact', () => {
  it('reads the stored bytes back', async () => {
    const result = await ingestReference(deps, command())
    if (result.kind !== 'stored') throw new Error('not stored')

    const bytes = await readBlob(blobStore, result.snapshot.artifactHash)
    expect(bytes).not.toBeNull()
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toContain('formatVersion')
    expect(await openReferenceArtifact(deps, result.snapshot)).not.toBeNull()
  })

  it('answers null when the object is missing', async () => {
    const result = await ingestReference(deps, command())
    if (result.kind !== 'stored') throw new Error('not stored')
    await blobStore.delete(result.snapshot.artifactHash)

    expect(await openReferenceArtifact(deps, result.snapshot)).toBeNull()
  })
})
