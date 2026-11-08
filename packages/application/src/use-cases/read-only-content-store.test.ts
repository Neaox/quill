import { describe, expect, it } from 'vitest'
import { documentId, unitId, workspaceId } from '@quill/domain'

import {
  createFakeContentStore,
  createInMemoryUnitOfWork,
  serialise,
} from '../test-support/index.ts'
import {
  refuseWritesToSourcedWorkspaces,
  WorkspaceReadOnlyError,
} from './read-only-content-store.ts'

const NATIVE = workspaceId('00000000-0000-4000-8000-000000000101')
const SOURCED = workspaceId('00000000-0000-4000-8000-000000000102')
const UNKNOWN = workspaceId('00000000-0000-4000-8000-000000000103')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const NOW = new Date('2026-01-01T00:00:00.000Z')
const AUTHOR = { name: 'Ada', email: 'ada@example.com' }

async function setUp() {
  const uow = createInMemoryUnitOfWork()
  const unit = unitId('00000000-0000-4000-8000-000000000001')
  for (const [id, slug] of [
    [NATIVE, 'native'],
    [SOURCED, 'sourced'],
  ] as const) {
    await uow.repos.workspaces.create({ id, unitId: unit, name: slug, slug, now: NOW })
  }
  uow.sourceWorkspace(SOURCED)
  const inner = createFakeContentStore()
  const store = refuseWritesToSourcedWorkspaces(inner, uow.repos.workspaces)
  return { inner, store }
}

const publishTo = (workspace: typeof NATIVE) => ({
  workspaceId: workspace,
  changes: [
    {
      kind: 'write' as const,
      documentId: DOC,
      path: 'a.md',
      markdown: serialise({ id: DOC }, 'A'),
    },
  ],
  author: AUTHOR,
  base: null,
})

const putFileTo = (workspace: typeof NATIVE) => ({
  workspaceId: workspace,
  path: '.quill/settings.yaml',
  text: 'x: 1',
  expected: null,
  author: AUTHOR,
})

describe('refuseWritesToSourcedWorkspaces', () => {
  it('refuses to publish to or write a file in a sourced workspace', async () => {
    const { inner, store } = await setUp()
    await expect(store.publish(publishTo(SOURCED))).rejects.toBeInstanceOf(WorkspaceReadOnlyError)
    await expect(store.putFile(putFileTo(SOURCED))).rejects.toThrow(
      `Workspace ${SOURCED} is read from a repository`,
    )
    expect(inner.requests).toEqual([])
    expect(inner.writtenFiles).toEqual([])
  })

  it('writes a native workspace, and one it does not know, through to the store', async () => {
    const { inner, store } = await setUp()
    expect((await store.publish(publishTo(NATIVE))).kind).toBe('published')
    expect((await store.putFile(putFileTo(UNKNOWN))).kind).toBe('published')
    expect(inner.requests).toHaveLength(1)
    expect(inner.writtenFiles).toHaveLength(1)
  })

  it('reads every workspace exactly as the store underneath does', async () => {
    const { inner, store } = await setUp()
    const published = await inner.publish(publishTo(SOURCED))
    await inner.putFile(putFileTo(SOURCED))
    const revision = published.kind === 'published' ? published.revision : null
    if (revision === null) throw new Error('expected a publish')

    expect(await store.read(SOURCED, DOC)).toEqual(await inner.read(SOURCED, DOC))
    expect(await store.read(SOURCED, DOC, revision)).toEqual(
      await inner.read(SOURCED, DOC, revision),
    )
    expect(await store.history(SOURCED, DOC, { limit: 5 })).toEqual(
      await inner.history(SOURCED, DOC, { limit: 5 }),
    )
    expect(await store.diff(SOURCED, DOC, null, revision)).toEqual(
      await inner.diff(SOURCED, DOC, null, revision),
    )
    expect(await store.listTree(SOURCED, revision)).toEqual(await inner.listTree(SOURCED, revision))
    expect(await store.head(SOURCED)).toBe(await inner.head(SOURCED))
    expect(await store.readFile(SOURCED, '.quill/settings.yaml')).toEqual(
      await inner.readFile(SOURCED, '.quill/settings.yaml'),
    )
  })
})
