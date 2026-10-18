import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, PUBLIC_PRINCIPAL, userId, userPrincipal, workspaceId } from '@quill/domain'
import type { DocumentId, Principal } from '@quill/domain'

import { aShortId } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { listTreeChildren } from './list-tree-children.ts'
import type { ListTreeChildrenCommand } from './list-tree-children.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const READER = userId('00000000-0000-4000-8000-000000000001')
const identities: readonly Principal[] = [userPrincipal(READER), PUBLIC_PRINCIPAL]

const id = (n: number): DocumentId =>
  documentId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

let uow: InMemoryUnitOfWork

/** Documents made one minute apart, so that the order they were made in is the order they have. */
async function aDocument(n: number, title: string, parent: DocumentId | null = null) {
  await uow.repos.documents.create({
    id: id(n),
    shortId: aShortId(),
    workspaceId: WORKSPACE,
    collectionId: 'log',
    parentId: parent,
    slug: title.toLowerCase(),
    path: `log/${title}.md`,
    title,
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: new Date(NOW.getTime() + n * 60_000),
  })
}

const ask = (overrides: Partial<ListTreeChildrenCommand> = {}) =>
  listTreeChildren(
    { uow },
    {
      workspaceId: WORKSPACE,
      collectionId: 'log',
      parentId: null,
      after: null,
      limit: 2,
      identities,
      seesEverything: true,
      ...overrides,
    },
  )

const titlesOf = (result: Awaited<ReturnType<typeof ask>>): string[] =>
  result.kind === 'children' ? result.nodes.map(({ title }) => title) : []

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  await uow.repos.units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'log',
    workspaceId: WORKSPACE,
    name: 'Log',
    slug: 'log',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'other',
    workspaceId: WORKSPACE,
    name: 'Other',
    slug: 'other',
    now: NOW,
  })
})

describe('listTreeChildren', () => {
  it('gives the first page of a collection in the order the documents were made, and where the next begins', async () => {
    for (const [n, title] of [
      [1, 'First'],
      [2, 'Second'],
      [3, 'Third'],
    ] as const) {
      await aDocument(n, title)
    }

    const first = await ask()

    expect(titlesOf(first)).toEqual(['First', 'Second'])
    expect(first.kind === 'children' && first.next).toMatchObject({ id: id(2) })
  })

  it('carries on from where the last page ended, until there is no more', async () => {
    for (const [n, title] of [
      [1, 'First'],
      [2, 'Second'],
      [3, 'Third'],
    ] as const) {
      await aDocument(n, title)
    }
    const first = await ask()
    if (first.kind !== 'children') throw new Error(first.kind)

    const second = await ask({ after: first.next })

    expect(titlesOf(second)).toEqual(['Third'])
    expect(second.kind === 'children' && second.next).toBeNull()
  })

  it('does not repeat or skip a document made while somebody was reading', async () => {
    for (const [n, title] of [
      [1, 'First'],
      [2, 'Second'],
      [3, 'Third'],
    ] as const) {
      await aDocument(n, title)
    }
    const first = await ask()
    if (first.kind !== 'children') throw new Error(first.kind)

    await aDocument(4, 'Fourth')
    const second = await ask({ after: first.next })

    expect(titlesOf(second)).toEqual(['Third', 'Fourth'])
  })

  it('says how many documents each one has beneath it', async () => {
    await aDocument(1, 'Parent')
    await aDocument(2, 'Child one', id(1))
    await aDocument(3, 'Child two', id(1))
    await aDocument(4, 'Alone')

    const result = await ask({ limit: 10 })

    expect(result.kind === 'children' && result.nodes.map((node) => node.childCount)).toEqual([
      2, 0,
    ])
  })

  it('gives the children of a parent, and only those', async () => {
    await aDocument(1, 'Parent')
    await aDocument(2, 'Child', id(1))
    await aDocument(3, 'Grandchild', id(2))

    expect(titlesOf(await ask({ parentId: id(1) }))).toEqual(['Child'])
    expect(titlesOf(await ask({ parentId: id(2) }))).toEqual(['Grandchild'])
  })

  it('says so for a collection that is not in the workspace, or a workspace that does not exist', async () => {
    expect(await ask({ collectionId: 'nope' })).toEqual({
      kind: 'collection-not-found',
      collectionId: 'nope',
    })
    expect(
      await ask({ workspaceId: workspaceId('00000000-0000-4000-8000-0000000001ff') }),
    ).toMatchObject({
      kind: 'workspace-not-found',
    })
  })

  it('reports a broken tree rather than looping on it', async () => {
    await uow.repos.units.create({
      id: 'loop',
      parentId: 'loop',
      name: 'Loop',
      slug: 'loop',
      label: 'team',
      now: NOW,
    })
    const looping = workspaceId('00000000-0000-4000-8000-000000000102')
    await uow.repos.workspaces.create({
      id: looping,
      unitId: 'loop',
      name: 'Looping',
      slug: 'looping',
      now: NOW,
    })
    await uow.repos.collections.create({
      id: 'log',
      workspaceId: looping,
      name: 'Log',
      slug: 'log',
      now: NOW,
    })

    expect(await ask({ workspaceId: looping, seesEverything: false })).toEqual({
      kind: 'broken-tree',
      failure: { kind: 'unit-cycle', unitId: 'loop' },
    })
  })

  describe('for a reader who may see only some of it', () => {
    beforeEach(async () => {
      await aDocument(1, 'Hidden one')
      await aDocument(2, 'Visible one')
      await aDocument(3, 'Hidden two')
      await aDocument(4, 'Visible two')
      await aDocument(5, 'Visible three')
      for (const n of [2, 4, 5]) {
        await uow.repos.grants.create({
          id: `grant-${String(n)}`,
          principalKind: 'user',
          principalId: READER,
          scopeKind: 'document',
          scopeId: id(n),
          role: 'viewer',
          effect: 'allow',
          createdBy: null,
          now: NOW,
        })
      }
    })

    it('skips what is hidden rather than counting it, so a page is as many as can be seen', async () => {
      const first = await ask({ seesEverything: false })

      expect(titlesOf(first)).toEqual(['Visible one', 'Visible two'])
      if (first.kind !== 'children') throw new Error(first.kind)
      const second = await ask({ seesEverything: false, after: first.next })
      expect(titlesOf(second)).toEqual(['Visible three'])
      expect(second.kind === 'children' && second.next).toBeNull()
    })

    it('answers an empty page for a parent with nothing under it', async () => {
      const result = await ask({ seesEverything: false, parentId: id(2) })

      expect(result).toEqual({ kind: 'children', nodes: [], next: null })
    })

    it('counts only the children that can be seen', async () => {
      await aDocument(6, 'Visible child', id(2))
      await aDocument(7, 'Hidden child', id(2))
      await uow.repos.grants.create({
        id: 'grant-7',
        principalKind: 'user',
        principalId: READER,
        scopeKind: 'document',
        scopeId: id(7),
        role: 'viewer',
        effect: 'deny',
        createdBy: null,
        now: NOW,
      })

      const result = await ask({ seesEverything: false, limit: 1 })

      expect(result.kind === 'children' && result.nodes[0]?.childCount).toBe(1)
    })
  })
})

describe('listTreeChildren: a tree that cannot be walked', () => {
  it('reports it rather than guessing what the reader may see', async () => {
    // A document whose parent is not in the workspace leaves its place in the tree unknown.
    await aDocument(1, 'Orphan', id(99))

    expect(await ask({ seesEverything: false })).toEqual({
      kind: 'broken-tree',
      failure: { kind: 'unknown-document', documentId: id(99) },
    })
  })
})
