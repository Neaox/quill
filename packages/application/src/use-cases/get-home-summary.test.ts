import { beforeEach, describe, expect, it } from 'vitest'
import {
  documentId as toDocumentId,
  PUBLIC_PRINCIPAL,
  revisionId,
  userId,
  userPrincipal,
  workspaceId,
} from '@quill/domain'
import type { DocumentId, Principal, UserId } from '@quill/domain'

import { aShortId } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { getHomeSummary, WORKSPACES_IN_FLIGHT } from './get-home-summary.ts'

const NOW = new Date('2026-10-13T12:00:00.000Z')
const READER = userId('00000000-0000-4000-8000-000000000001')
const HEAD = revisionId('a'.repeat(40))
const WRITER = userId('00000000-0000-4000-8000-000000000002')
const identities: readonly Principal[] = [userPrincipal(READER), PUBLIC_PRINCIPAL]

const workspaceAt = (n: number) =>
  workspaceId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

let uow: InMemoryUnitOfWork
let counter = 0

async function addWorkspace(n: number): Promise<void> {
  const id = workspaceAt(n)
  await uow.repos.workspaces.create({
    id,
    unitId: 'acme',
    name: `Workspace ${n}`,
    slug: `workspace-${n}`,
    now: NOW,
  })
  await uow.repos.collections.create({
    id: `collection-${n}`,
    workspaceId: id,
    name: 'Docs',
    slug: 'docs',
    now: NOW,
  })
}

interface AddOptions {
  readonly draft?: boolean
  readonly createdBy?: UserId
  readonly updatedBy?: UserId
  /** When it was created, if that differs from when it last changed. */
  readonly createdHoursAgo?: number
}

/** A document in workspace `n`, changed `hoursAgo` hours before the fixed now; published unless `draft`. */
async function addDocument(
  n: number,
  title: string,
  hoursAgo: number,
  { draft = false, createdBy, updatedBy, createdHoursAgo = hoursAgo }: AddOptions = {},
): Promise<DocumentId> {
  counter += 1
  const created = await uow.repos.documents.create({
    id: `00000000-0000-4000-8000-${String(1000 + counter).padStart(12, '0')}` as never,
    shortId: aShortId(counter),
    workspaceId: workspaceAt(n),
    collectionId: `collection-${n}`,
    parentId: null,
    slug: title.toLowerCase(),
    path: `docs/${title}.md`,
    title,
    status: draft ? 'draft' : 'published',
    templateId: null,
    templateVersion: null,
    ...(createdBy === undefined ? {} : { createdBy }),
    now: new Date(NOW.getTime() - createdHoursAgo * 3_600_000),
  })
  if (!draft) {
    await uow.repos.documents.update(
      created.id,
      { headRevision: HEAD, ...(updatedBy === undefined ? {} : { updatedBy }) },
      new Date(NOW.getTime() - hoursAgo * 3_600_000),
    )
  }
  return created.id
}

/** The reader opened `documentId` `hoursAgo` hours before the fixed now. */
async function open(documentId: DocumentId, n: number, hoursAgo: number): Promise<void> {
  await uow.repos.documentViews.touch({
    userId: READER,
    documentId,
    workspaceId: workspaceAt(n),
    now: new Date(NOW.getTime() - hoursAgo * 3_600_000),
    debounceBefore: new Date(0),
  })
}

const summary = (
  seesEverything = true,
  limits = { draftLimit: 5, recentLimit: 10 },
  scope?: 'mine' | 'everywhere',
) =>
  getHomeSummary(
    { uow },
    { userId: READER, identities, seesEverything, now: NOW, scope, ...limits },
  )

beforeEach(async () => {
  counter = 0
  uow = createInMemoryUnitOfWork()
  await uow.repos.units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
})

describe('getHomeSummary', () => {
  it('is empty for an instance with nothing in it', async () => {
    expect(await summary()).toEqual({
      workspaces: [],
      stats: [],
      drafts: { total: 0, items: [] },
      recent: [],
      jumpBackIn: [],
      scope: 'everywhere',
      hasHistory: false,
      anyPublished: false,
    })
  })

  it('counts each workspace and keeps only the newest of each list', async () => {
    await addWorkspace(1)
    await addWorkspace(2)
    await addDocument(1, 'Old page', 30)
    await addDocument(1, 'New page', 2)
    await addDocument(1, 'Idea', 5, { draft: true, createdBy: READER })
    await addDocument(2, 'Middle page', 10)
    await addDocument(2, 'Stale idea', 50, { draft: true, createdBy: READER })

    const result = await summary(true, { draftLimit: 1, recentLimit: 2 })

    expect(result.recent.map((row) => row.title)).toEqual(['New page', 'Middle page'])
    expect(result.drafts.items.map((row) => row.title)).toEqual(['Idea'])
    // The total is the whole count, so the section can say "1 of 2".
    expect(result.drafts.total).toBe(2)
    expect(result.anyPublished).toBe(true)
    expect(result.stats.map((row) => [row.documentCount, row.draftCount])).toEqual([
      [3, 1],
      [2, 1],
    ])
    expect(result.stats[0]?.updatedAt).toEqual(new Date(NOW.getTime() - 2 * 3_600_000))
  })

  it('says nothing about documents the reader may not open', async () => {
    await addWorkspace(1)
    await addDocument(1, 'Secret', 1)

    const result = await summary(false)

    expect(result.recent).toEqual([])
    expect(result.workspaces).toEqual([])
  })

  it('reads many workspaces without losing any of them', async () => {
    const count = WORKSPACES_IN_FLIGHT * 3 + 1
    for (let n = 1; n <= count; n += 1) {
      await addWorkspace(n)
      await addDocument(n, `Page ${n}`, n)
    }

    const result = await summary()

    expect(result.stats).toHaveLength(count)
    expect(result.recent.map((row) => row.title)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Page ${index + 1}`),
    )
  })

  it('leaves a workspace without figures when its tree cannot be walked, and shows the rest', async () => {
    await addWorkspace(1)
    await addWorkspace(2)
    await addDocument(2, 'Fine', 1)
    // A document under a parent that is not there: the workspace's tree is broken.
    const orphan = await addDocument(1, 'Orphan', 1)
    await uow.repos.documents.update(
      orphan,
      { parentId: toDocumentId('00000000-0000-4000-8000-0000000009ff') },
      NOW,
    )
    for (const n of [1, 2]) {
      await uow.repos.grants.create({
        id: `grant-${String(n)}`,
        principalKind: 'user',
        principalId: READER,
        scopeKind: 'workspace',
        scopeId: workspaceAt(n),
        role: 'viewer',
        effect: 'allow',
        createdBy: null,
        now: NOW,
      })
    }

    const result = await summary(false)

    expect(result.stats.map((stat) => stat.workspaceId)).toEqual([workspaceAt(2)])
    expect(result.recent.map((change) => change.title)).toEqual(['Fine'])
  })

  describe('what is mine', () => {
    beforeEach(async () => {
      await uow.repos.users.create({
        id: WRITER,
        email: 'writer@example.com',
        displayName: 'Wendy Writer',
        now: NOW,
      })
    })

    it('lists only the never-published documents the reader created', async () => {
      await addWorkspace(1)
      await addDocument(1, 'Mine', 3, { draft: true, createdBy: READER })
      await addDocument(1, 'Theirs', 2, { draft: true, createdBy: WRITER })
      await addDocument(1, 'Nobody', 1, { draft: true })

      const result = await summary()

      expect(result.drafts.items.map((row) => row.title)).toEqual(['Mine'])
      expect(result.drafts.total).toBe(1)
      // The workspace card still counts the drafts the reader could see.
      expect(result.stats[0]?.draftCount).toBe(3)
    })

    it('is everywhere, with no history, for somebody new', async () => {
      await addWorkspace(1)
      await addDocument(1, 'Somewhere', 1, { updatedBy: WRITER })

      const result = await summary()

      expect(result).toMatchObject({ scope: 'everywhere', hasHistory: false })
      expect(result.recent.map((row) => row.title)).toEqual(['Somewhere'])
      expect(result.stats[0]?.engagement).toBe(0)
    })

    it('narrows to the workspaces the reader created in or opened, once they have history', async () => {
      await addWorkspace(1)
      await addWorkspace(2)
      await addWorkspace(3)
      await addDocument(1, 'Where I write', 4, { updatedBy: WRITER })
      await addDocument(1, 'My own page', 3, { createdBy: READER, updatedBy: READER })
      await addDocument(2, 'Where I read', 2, { updatedBy: WRITER })
      await addDocument(3, 'Elsewhere', 1, { updatedBy: WRITER })
      const read = await addDocument(2, 'Read me', 20)
      await open(read, 2, 6)

      const result = await summary()

      expect(result).toMatchObject({ scope: 'mine', hasHistory: true })
      // Workspace 3 is neither opened nor written in; 'My own page' is the reader's own edit.
      expect(result.recent.map((row) => row.title)).toEqual([
        'Where I read',
        'Where I write',
        'Read me',
      ])
    })

    it('shows everywhere when asked, own edits included', async () => {
      await addWorkspace(1)
      await addWorkspace(2)
      await addDocument(1, 'My own page', 3, { createdBy: READER, updatedBy: READER })
      await addDocument(2, 'Elsewhere', 1, { updatedBy: WRITER })

      const result = await summary(true, { draftLimit: 5, recentLimit: 10 }, 'everywhere')

      expect(result.scope).toBe('everywhere')
      expect(result.hasHistory).toBe(true)
      expect(result.recent.map((row) => row.title)).toEqual(['Elsewhere', 'My own page'])
    })

    it('honours an explicit mine for somebody with no history, which is then empty', async () => {
      await addWorkspace(1)
      await addDocument(1, 'Somewhere', 1, { updatedBy: WRITER })

      const result = await summary(true, { draftLimit: 5, recentLimit: 10 }, 'mine')

      expect(result.scope).toBe('mine')
      expect(result.recent).toEqual([])
    })

    it('ignores history older than ninety days', async () => {
      await addWorkspace(1)
      await addDocument(1, 'Old and mine', 91 * 24, { createdBy: READER })
      const stale = await addDocument(1, 'Opened long ago', 91 * 24)
      await open(stale, 1, 91 * 24)

      const result = await summary()

      expect(result.hasHistory).toBe(false)
      expect(result.jumpBackIn).toEqual([])
      expect(result.stats[0]?.engagement).toBe(0)
    })

    it('names who made each recent change, and says null when that is unknown', async () => {
      await addWorkspace(1)
      await addDocument(1, 'By Wendy', 1, { updatedBy: WRITER })
      await addDocument(1, 'By nobody known', 2)

      const result = await summary()

      expect(result.recent.map((row) => row.updatedBy)).toEqual([
        { id: WRITER, name: 'Wendy Writer' },
        null,
      ])
    })

    it('counts views and created documents as a workspace engagement', async () => {
      await addWorkspace(1)
      await addWorkspace(2)
      const first = await addDocument(1, 'Opened twice', 5)
      await open(first, 1, 10)
      await uow.repos.documentViews.touch({
        userId: READER,
        documentId: first,
        workspaceId: workspaceAt(1),
        now: new Date(NOW.getTime() - 3_600_000),
        debounceBefore: new Date(NOW.getTime() - 2 * 3_600_000),
      })
      await addDocument(1, 'Made here', 4, { createdBy: READER })
      await addDocument(2, 'Untouched', 4)

      const result = await summary()

      // Two views of one document, plus one created.
      expect(result.stats.map((row) => row.engagement)).toEqual([3, 0])
    })
  })

  describe('jump back in', () => {
    it('lists what the reader opened, newest first, and only what they can still open', async () => {
      await addWorkspace(1)
      const older = await addDocument(1, 'Older', 30)
      const newer = await addDocument(1, 'Newer', 20)
      await open(older, 1, 8)
      await open(newer, 1, 2)
      await uow.repos.documentViews.touch({
        userId: READER,
        documentId: 'gone-' as DocumentId,
        workspaceId: workspaceAt(1),
        now: new Date(NOW.getTime() - 3_600_000),
        debounceBefore: new Date(0),
      })

      const result = await summary()

      expect(result.jumpBackIn.map((row) => [row.title, row.viewedAt])).toEqual([
        ['Newer', new Date(NOW.getTime() - 2 * 3_600_000)],
        ['Older', new Date(NOW.getTime() - 8 * 3_600_000)],
      ])
      expect(result.jumpBackIn[0]).toMatchObject({ slug: 'newer', workspaceId: workspaceAt(1) })
    })

    it('leaves out a document the reader may no longer open', async () => {
      await addWorkspace(1)
      const secret = await addDocument(1, 'Secret', 2)
      await open(secret, 1, 1)

      const result = await summary(false)

      expect(result.jumpBackIn).toEqual([])
    })

    it('is capped at eight', async () => {
      await addWorkspace(1)
      for (let n = 1; n <= 10; n += 1) {
        const id = await addDocument(1, `Page ${n}`, n)
        await open(id, 1, n)
      }

      const result = await summary()

      expect(result.jumpBackIn).toHaveLength(8)
      expect(result.jumpBackIn[0]?.title).toBe('Page 1')
    })
  })
})
