import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, revisionId, workspaceId } from '@quill/domain'
import type { RevisionId } from '@quill/domain'

import { createFakeContentStore } from './fake-content-store.ts'
import type { FakeContentStore } from './fake-content-store.ts'

const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const EMPTY = workspaceId('00000000-0000-4000-8000-0000000001ff')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const OTHER = documentId('00000000-0000-4000-8000-000000000202')
const NO_SUCH_REVISION = revisionId('f'.repeat(40))

const author = { name: 'Ada', email: 'ada@example.com' }

let store: FakeContentStore

async function write(markdown: string, base: RevisionId | null, path = 'a.md') {
  const result = await store.publish({
    workspaceId: WORKSPACE,
    base,
    author,
    summary: 'Publish',
    changes: [{ kind: 'write', documentId: DOC, path, markdown }],
  })
  if (result.kind !== 'published') throw new Error(result.kind)
  return result.revision
}

beforeEach(() => {
  store = createFakeContentStore()
})

describe('createFakeContentStore', () => {
  it('has no head and reads nothing before its first publish', async () => {
    expect(await store.head(EMPTY)).toBeNull()
    expect(await store.read(EMPTY, DOC)).toBeNull()
    expect(await store.listTree(EMPTY)).toEqual([])
    expect(await store.history(EMPTY, DOC, { limit: 10 })).toEqual([])
  })

  it('publishes, reads back at a revision, and lists the tree', async () => {
    const first = await write('one', null)
    const second = await write('two', first)

    expect(await store.head(WORKSPACE)).toBe(second)
    expect(await store.read(WORKSPACE, DOC)).toMatchObject({ markdown: 'two', revision: second })
    expect(await store.read(WORKSPACE, DOC, first)).toMatchObject({ markdown: 'one' })
    expect(await store.read(WORKSPACE, OTHER)).toBeNull()
    expect(await store.read(WORKSPACE, DOC, NO_SUCH_REVISION)).toBeNull()
    expect(await store.listTree(WORKSPACE)).toEqual([
      { path: 'a.md', kind: 'document', documentId: DOC },
    ])
    expect(store.requests).toHaveLength(2)
  })

  it('conflicts only where a stale publish really moved the document underneath', async () => {
    const first = await write('one', null)
    await write('two', first)

    const stale = await store.publish({
      workspaceId: WORKSPACE,
      base: first,
      author,
      changes: [{ kind: 'write', documentId: DOC, path: 'a.md', markdown: 'three' }],
    })
    expect(stale.kind).toBe('merge-required')
    if (stale.kind !== 'merge-required') return
    expect(stale.conflicts[0]).toMatchObject({ ours: 'three', theirs: 'two' })

    const identical = await store.publish({
      workspaceId: WORKSPACE,
      base: first,
      author,
      changes: [{ kind: 'write', documentId: DOC, path: 'a.md', markdown: 'two' }],
    })
    expect(identical.kind).toBe('published')

    const untouched = await store.publish({
      workspaceId: WORKSPACE,
      base: first,
      author,
      changes: [{ kind: 'write', documentId: OTHER, path: 'b.md', markdown: 'new' }],
    })
    expect(untouched.kind).toBe('published')
  })

  it('moves and deletes documents', async () => {
    const first = await write('one', null)
    const moved = await store.publish({
      workspaceId: WORKSPACE,
      base: first,
      author,
      changes: [{ kind: 'move', documentId: DOC, fromPath: 'a.md', toPath: 'b.md' }],
    })
    expect(moved.kind).toBe('published')
    expect(await store.read(WORKSPACE, DOC)).toMatchObject({ path: 'b.md', markdown: 'one' })

    const rewritten = await store.publish({
      workspaceId: WORKSPACE,
      base: await store.head(WORKSPACE),
      author,
      changes: [
        { kind: 'move', documentId: OTHER, fromPath: 'c.md', toPath: 'd.md', markdown: 'fresh' },
      ],
    })
    expect(rewritten.kind).toBe('published')
    expect(await store.read(WORKSPACE, OTHER)).toMatchObject({ path: 'd.md', markdown: 'fresh' })

    await store.publish({
      workspaceId: WORKSPACE,
      base: await store.head(WORKSPACE),
      author,
      changes: [{ kind: 'delete', documentId: DOC, path: 'b.md' }],
    })
    expect(await store.read(WORKSPACE, DOC)).toBeNull()

    const nothingToCarry = await store.publish({
      workspaceId: WORKSPACE,
      base: await store.head(WORKSPACE),
      author,
      changes: [{ kind: 'move', documentId: DOC, fromPath: 'b.md', toPath: 'e.md' }],
    })
    expect(nothingToCarry.kind).toBe('published')
    expect(await store.read(WORKSPACE, DOC)).toBeNull()
  })

  it('never conflicts over a change that carries no content of its own', async () => {
    const first = await write('one', null)
    await write('two', first)

    const deletion = await store.publish({
      workspaceId: WORKSPACE,
      base: first,
      author,
      changes: [{ kind: 'delete', documentId: DOC, path: 'a.md' }],
    })
    expect(deletion.kind).toBe('published')
  })

  it('pages history newest first, carrying the change note it was given', async () => {
    const first = await write('one', null)
    await store.publish({
      workspaceId: WORKSPACE,
      base: first,
      author,
      changeNote: 'Second pass',
      changes: [{ kind: 'write', documentId: DOC, path: 'a.md', markdown: 'two' }],
    })

    const page = await store.history(WORKSPACE, DOC, { limit: 1 })
    const cursor = page[0]?.revision
    expect(page[0]).toMatchObject({ changeNote: 'Second pass', summary: 'Publish' })
    expect(cursor).toBeDefined()
    const next = await store.history(WORKSPACE, DOC, { limit: 1, cursor: cursor ?? '' })
    expect(next[0]?.revision).toBe(first)
    expect(next[0]).not.toHaveProperty('changeNote')
  })

  it('diffs a revision against another and against nothing', async () => {
    const first = await write('one', null)
    const second = await write('two', first)

    expect(await store.diff(WORKSPACE, DOC, first, second)).toMatchObject({
      added: 1,
      removed: 1,
      unified: '--- a/a.md\n+++ b/a.md\n-one\n+two',
    })
    expect(await store.diff(WORKSPACE, DOC, null, first)).toMatchObject({ removed: 0 })
    expect(await store.diff(WORKSPACE, OTHER, null, second)).toMatchObject({ added: 0 })
    expect(await store.diff(WORKSPACE, DOC, NO_SUCH_REVISION, second)).toMatchObject({ removed: 0 })
  })
})

describe('non-document files', () => {
  const SETTINGS = '.quill/organisation.yaml'

  const put = async (text: string, expected: string | null) =>
    await store.putFile({
      workspaceId: WORKSPACE,
      path: SETTINGS,
      text,
      expected,
      author,
    })

  it('is null before anything has been written there', async () => {
    expect(await store.readFile(WORKSPACE, SETTINGS)).toBeNull()
    await write('one', null)
    expect(await store.readFile(WORKSPACE, SETTINGS)).toBeNull()
  })

  it('writes a file and reads it back, recording the request', async () => {
    expect(await put('version: 1\n', null)).toMatchObject({ kind: 'published' })
    expect(await store.readFile(WORKSPACE, SETTINGS)).toMatchObject({ text: 'version: 1\n' })
    expect(store.writtenFiles).toHaveLength(1)
  })

  it('keeps earlier revisions of the file', async () => {
    const first = await put('version: 1\n', null)
    if (first.kind !== 'published') throw new Error('expected the first write to land')
    await put('version: 2\n', 'version: 1\n')
    expect(await store.readFile(WORKSPACE, SETTINGS, first.revision)).toMatchObject({
      text: 'version: 1\n',
    })
  })

  it('refuses a write whose expectation no longer holds', async () => {
    await put('version: 1\n', null)
    expect(await put('version: 3\n', 'version: 2\n')).toMatchObject({
      kind: 'stale',
      current: { text: 'version: 1\n' },
    })
  })

  it('refuses a replacement when there is nothing there', async () => {
    expect(await put('version: 1\n', 'version: 0\n')).toEqual({ kind: 'stale', current: null })
  })

  it('keeps the documents beside it, and lists both', async () => {
    await write('one', null)
    await put('version: 1\n', null)
    expect(await store.read(WORKSPACE, DOC)).toMatchObject({ markdown: 'one' })
    expect(await store.listTree(WORKSPACE)).toEqual([
      { path: 'a.md', kind: 'document', documentId: DOC },
      { path: SETTINGS, kind: 'other' },
    ])
  })
})
