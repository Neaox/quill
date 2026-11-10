import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { aShortId, createInMemoryUnitOfWork } from '../test-support/index.ts'
import type { InMemoryUnitOfWork } from '../test-support/index.ts'
import { followRedirects, MAX_REDIRECT_HOPS, readSourceRemoval } from './source-removal.ts'
import type { SourceAddresses } from './source-removal.ts'

const NOW = new Date('2026-06-01T12:00:00.000Z')
const REMOVED = new Date('2026-06-02T12:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')

let uow: InMemoryUnitOfWork
let next = 0

async function document(
  path: string,
  status: 'published' | 'archived' = 'published',
): Promise<DocumentId> {
  next += 1
  const id = documentId(`00000000-0000-4000-8000-${String(next).padStart(12, '0')}`)
  await uow.repos.documents.create({
    id,
    shortId: aShortId(),
    workspaceId: WORKSPACE,
    collectionId: null,
    parentId: null,
    slug: path,
    path,
    title: `Page at ${path}`,
    status,
    templateId: null,
    templateVersion: null,
    createdBy: null,
    now: NOW,
  })
  await uow.repos.sourcePaths.put(
    {
      workspaceId: WORKSPACE,
      path,
      documentId: id,
      archivedAt: status === 'archived' ? REMOVED : null,
      order: null,
    },
    NOW,
  )
  return id
}

async function redirects(pairs: readonly (readonly [string, string])[]): Promise<void> {
  await uow.repos.sourceSyncState.recordSynced({
    workspaceId: WORKSPACE,
    revision: 'c1',
    refused: [],
    layout: {
      origin: 'manifest',
      fingerprint: '{}',
      collectionIds: [],
      unknownKeys: [],
      redirects: pairs,
    },
    brokenLinks: [],
    now: NOW,
  })
}

async function row(id: DocumentId) {
  const found = await uow.repos.documents.findById(id)
  if (found === null) throw new Error('no document')
  return found
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Handbook',
    slug: 'handbook',
    now: NOW,
  })
  await uow.repos.workspaceSources.put({
    workspaceId: WORKSPACE,
    remote: 'https://github.com/acme/handbook.git',
    branch: 'main',
    collections: [],
    history: 'full',
    commitMessages: 'subject',
    manifestEntry: null,
    credential: null,
    outsideLinks: 'forge',
    viewTemplate: null,
    webhookSecretName: null,
    configuredBy: userId('00000000-0000-4000-8000-000000000001'),
    now: NOW,
  })
})

describe('readSourceRemoval', () => {
  it('says nothing of a page that is there', async () => {
    const id = await document('docs/a.md')
    expect(await readSourceRemoval({ uow }, await row(id))).toBeNull()
  })

  it('says when a page was removed, and that nothing replaces it', async () => {
    const id = await document('docs/gone.md', 'archived')
    await redirects([])
    expect(await readSourceRemoval({ uow }, await row(id))).toEqual({
      title: 'Page at docs/gone.md',
      removedAt: REMOVED,
      revision: null,
      replacement: null,
    })
  })

  it('names the page a redirect leads to, through a removed page redirected in turn', async () => {
    const old = await document('docs/old.md', 'archived')
    await document('docs/middle.md', 'archived')
    const target = await document('docs/new.md')
    await redirects([
      ['docs/old.md', 'docs/middle.md'],
      ['docs/middle.md', 'docs/new.md'],
    ])
    expect((await readSourceRemoval({ uow }, await row(old)))?.replacement).toBe(target)
  })

  it('reads an archived page of a workspace written here, and one with no path, as no removal', async () => {
    const id = await document('docs/gone.md', 'archived')
    await redirects([])
    const orphan = await row(id)
    await uow.repos.sourcePaths.remove(WORKSPACE, 'docs/gone.md')
    expect(await readSourceRemoval({ uow }, orphan)).toMatchObject({ replacement: null })
    const native = { ...orphan, workspaceId: workspaceId('00000000-0000-4000-8000-000000000999') }
    expect(await readSourceRemoval({ uow }, native)).toBeNull()
  })
})

describe('followRedirects', () => {
  const live = documentId('00000000-0000-4000-8000-0000000000aa')
  const at = (
    rows: readonly (readonly [string, boolean])[],
    pairs: readonly (readonly [string, string])[],
  ): SourceAddresses => ({
    paths: new Map(
      rows.map(([path, archived]) => [
        path,
        {
          workspaceId: WORKSPACE,
          path,
          documentId: live,
          archivedAt: archived ? REMOVED : null,
          order: null,
        },
      ]),
    ),
    roots: new Map(),
    redirects: new Map(pairs),
  })

  it('stops at a redirect to a path the source never had, and at a cycle', () => {
    expect(followRedirects('a', at([], [['a', 'b']]))).toBeNull()
    expect(
      followRedirects(
        'a',
        at(
          [
            ['a', true],
            ['b', true],
          ],
          [
            ['a', 'b'],
            ['b', 'a'],
          ],
        ),
      ),
    ).toBeNull()
  })

  it(`gives up after ${String(MAX_REDIRECT_HOPS)} hops`, () => {
    const chain = Array.from({ length: MAX_REDIRECT_HOPS + 2 }, (_, index) => `p${String(index)}`)
    const rows = chain.map((path, index) => [path, index < chain.length - 1] as const)
    const pairs = chain.slice(0, -1).map((path, index) => [path, chain[index + 1] ?? ''] as const)
    expect(followRedirects('p0', at(rows, pairs))).toBeNull()
    expect(followRedirects('p2', at(rows, pairs))).toBe(live)
  })
})
