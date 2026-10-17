import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'
import type { DocumentId, LinkPreviewView } from '@quill/domain'

import { defaultOrganisationSettings } from '../settings/documents.ts'
import {
  aShortId,
  createFakeClock,
  createFakeIdGenerator,
  createFakeTokenService,
} from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createAuthorizer } from './authorizer.ts'
import { readInternalLinkPreviews } from './internal-link-previews.ts'
import type { InternalLinkDependencies, InternalLinkViewer } from './internal-link-previews.ts'
import type { PublicSite } from './public-site.ts'

const NOW = new Date('2026-10-17T09:00:00.000Z')
const READER = userId('00000000-0000-4000-8000-000000000001')
const STRANGER = userId('00000000-0000-4000-8000-000000000002')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OPEN = documentId('00000000-0000-4000-8000-000000000201')
const SECRET = documentId('00000000-0000-4000-8000-000000000202')
const ELSEWHERE = documentId('00000000-0000-4000-8000-000000000203')
const MISSING = documentId('00000000-0000-4000-8000-0000000002ff')

const keyOf = (id: DocumentId) => `/d/${id}`

let uow: InMemoryUnitOfWork
let described: DocumentId[]
let deps: InternalLinkDependencies

async function addDocument(id: DocumentId, collectionId: string, title: string) {
  await uow.repos.documents.create({
    id,
    shortId: aShortId(Number(id.slice(-3))),
    workspaceId: WORKSPACE,
    collectionId,
    parentId: null,
    slug: id,
    path: `${collectionId}/${id}.md`,
    title,
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
}

async function grant(principalId: string, scopeKind: 'workspace' | 'document', scopeId: string) {
  await uow.repos.grants.create({
    id: `grant-${principalId}-${scopeId}`,
    principalKind: 'user',
    principalId,
    effect: 'allow',
    role: 'viewer',
    scopeKind,
    scopeId,
    createdBy: null,
    now: NOW,
  })
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  described = []
  deps = {
    uow,
    describe: async (id) => {
      described.push(id)
      return `About ${id.slice(-3)}.`
    },
  }
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
  for (const [id, name] of [
    ['runbooks', 'Runbooks'],
    ['private', 'Private'],
  ] as const) {
    await uow.repos.collections.create({
      id,
      workspaceId: WORKSPACE,
      name,
      slug: id,
      now: NOW,
    })
  }
  await addDocument(OPEN, 'runbooks', 'Deploy runbook')
  await addDocument(SECRET, 'private', 'Layoff plan')
  await addDocument(ELSEWHERE, 'runbooks', 'Not on the site')
  for (const id of [READER, STRANGER]) {
    await uow.repos.users.create({
      id,
      email: `${id}@example.com`,
      displayName: 'Reader',
      now: NOW,
    })
  }
  // The reader may see the runbooks collection but not the private one.
  await grant(READER, 'document', OPEN)
  await grant(READER, 'document', ELSEWHERE)
})

function memberViewer(who: typeof READER): InternalLinkViewer {
  return {
    kind: 'authorized',
    authorizer: createAuthorizer(
      uow.repos,
      { userId: who, shareLinkToken: null },
      {
        uow,
        clock: createFakeClock(NOW),
        ids: createFakeIdGenerator('1111'),
        tokens: createFakeTokenService(),
        shareLinkPolicy: { allowed: () => true },
      },
    ),
  }
}

async function read(
  viewer: InternalLinkViewer,
  ids: readonly DocumentId[],
  withDescriptions = false,
) {
  const keys = ids.map(keyOf)
  return readInternalLinkPreviews(deps, {
    viewer,
    keys,
    ...(withDescriptions ? { described: new Set(keys) } : {}),
  })
}

function readyOf(views: ReadonlyMap<string, LinkPreviewView>, id: DocumentId) {
  const view = views.get(keyOf(id))
  if (view?.state !== 'ready') throw new Error(`expected ready, got ${view?.state}`)
  return view.preview
}

describe('readInternalLinkPreviews: a member', () => {
  it('shows the live title and place of a document they may view, with no fetch layer', async () => {
    const views = await read(memberViewer(READER), [OPEN])
    expect(readyOf(views, OPEN)).toMatchObject({
      title: 'Deploy runbook',
      siteName: null,
      canonicalUrl: `/d/${OPEN}`,
      layer: 'internal',
      thumbnail: null,
      favicon: null,
    })
  })

  it('names the collection as the place when the reader may see the collection too', async () => {
    await grant(READER, 'workspace', WORKSPACE)
    const views = await read(memberViewer(READER), [OPEN])
    expect(readyOf(views, OPEN).siteName).toBe('Runbooks')
  })

  it('tells a reader without access nothing: blocked, and no title anywhere', async () => {
    const views = await read(memberViewer(READER), [SECRET])
    expect(views.get(keyOf(SECRET))).toEqual({ state: 'blocked' })
    expect(JSON.stringify([...views])).not.toContain('Layoff')
  })

  it('answers a document that does not exist exactly as one that is denied', async () => {
    const views = await read(memberViewer(READER), [SECRET, MISSING])
    expect(views.get(keyOf(MISSING))).toEqual(views.get(keyOf(SECRET)))
  })

  it('treats a stranger with no grants as having no access to anything', async () => {
    const views = await read(memberViewer(STRANGER), [OPEN, SECRET])
    expect([...views.values()]).toEqual([{ state: 'blocked' }, { state: 'blocked' }])
  })

  it('shows a rename on the next read, since nothing is stored', async () => {
    await uow.repos.documents.update(OPEN, { title: 'Release runbook' }, NOW)
    const views = await read(memberViewer(READER), [OPEN])
    expect(readyOf(views, OPEN).title).toBe('Release runbook')
  })

  it('shows the place a document was moved to', async () => {
    await grant(READER, 'workspace', WORKSPACE)
    await uow.repos.documents.update(OPEN, { collectionId: 'private' }, NOW)
    const views = await read(memberViewer(READER), [OPEN])
    expect(readyOf(views, OPEN).siteName).toBe('Private')
  })

  it('stops showing a document once it is deleted', async () => {
    await uow.repos.documents.delete(OPEN)
    const views = await read(memberViewer(READER), [OPEN])
    expect(views.get(keyOf(OPEN))).toEqual({ state: 'blocked' })
  })

  it('stops showing a document the moment access is withdrawn', async () => {
    await uow.repos.grants.create({
      id: 'deny',
      principalKind: 'user',
      principalId: READER,
      effect: 'deny',
      role: 'viewer',
      scopeKind: 'document',
      scopeId: OPEN,
      createdBy: null,
      now: NOW,
    })
    const views = await read(memberViewer(READER), [OPEN])
    expect(views.get(keyOf(OPEN))).toEqual({ state: 'blocked' })
  })

  it('describes only the links asked to be described, and only those it will show', async () => {
    const plain = await read(memberViewer(READER), [OPEN, SECRET])
    expect(readyOf(plain, OPEN).description).toBeNull()
    expect(described).toEqual([])

    const asked = await read(memberViewer(READER), [OPEN, SECRET], true)
    expect(readyOf(asked, OPEN).description).toBe('About 201.')
    // A document the reader may not see is never rendered on their behalf.
    expect(described).toEqual([OPEN])
  })

  it('resolves a readable reference by its short key', async () => {
    const row = await uow.repos.documents.findById(OPEN)
    if (row === null) throw new Error('missing')
    const key = `/d/deploy-runbook-${row.shortId}`
    const views = await readInternalLinkPreviews(deps, {
      viewer: memberViewer(READER),
      keys: [key],
    })
    const view = views.get(key)
    expect(view?.state === 'ready' && view.preview.canonicalUrl).toBe(`/d/${OPEN}`)
  })

  it('falls back to a title for a document with none', async () => {
    await uow.repos.documents.update(OPEN, { title: '   ' }, NOW)
    expect(readyOf(await read(memberViewer(READER), [OPEN]), OPEN).title).toBe('Untitled')
  })

  it('ignores a key that is not a document reference', async () => {
    const views = await readInternalLinkPreviews(deps, {
      viewer: memberViewer(READER),
      keys: ['/d/!!!'],
    })
    expect(views.get('/d/!!!')).toEqual({ state: 'blocked' })
  })

  it('reads nothing for no keys', async () => {
    expect(
      (await readInternalLinkPreviews(deps, { viewer: memberViewer(READER), keys: [] })).size,
    ).toBe(0)
  })
})

describe('readInternalLinkPreviews: an anonymous reader of a public site', () => {
  async function siteWith(ids: readonly DocumentId[]): Promise<InternalLinkViewer> {
    const collection = await uow.repos.collections.findById('runbooks')
    if (collection === null) throw new Error('collection')
    const rows = await uow.repos.documents.listByIds(ids)
    const site: PublicSite = {
      collection,
      siteSlug: 'runbooks',
      organisation: defaultOrganisationSettings(),
      pages: new Map(rows.map((row) => [`runbooks/${row.slug}`, row])),
      pathById: new Map(rows.map((row) => [row.id, `runbooks/${row.slug}`])),
      navigation: [],
      home: null,
    }
    return { kind: 'site', site }
  }

  it('previews a document published on the site and points at its public page', async () => {
    const views = await read(await siteWith([OPEN]), [OPEN])
    expect(readyOf(views, OPEN)).toMatchObject({
      title: 'Deploy runbook',
      siteName: 'Runbooks',
      canonicalUrl: `/s/runbooks/runbooks/${OPEN}`,
    })
  })

  it('gives nothing for a document that is not published on the site, however real it is', async () => {
    const views = await read(await siteWith([OPEN]), [ELSEWHERE, SECRET, MISSING])
    expect([...views.values()]).toEqual([
      { state: 'blocked' },
      { state: 'blocked' },
      { state: 'blocked' },
    ])
    expect(JSON.stringify([...views])).not.toMatch(/Layoff|Not on the site/u)
  })

  it('finds a page by its short key', async () => {
    const row = await uow.repos.documents.findById(OPEN)
    if (row === null) throw new Error('missing')
    const key = `/d/${row.shortId}`
    const views = await readInternalLinkPreviews(deps, {
      viewer: await siteWith([OPEN]),
      keys: [key],
    })
    expect(views.get(key)?.state).toBe('ready')
  })

  it('gives nothing for a page whose path the site lists but whose page it lacks', async () => {
    const site = await siteWith([])
    if (site.kind !== 'site') throw new Error('expected a site')
    const lopsided: InternalLinkViewer = {
      kind: 'site',
      site: { ...site.site, pathById: new Map([[OPEN, 'runbooks/ghost']]) },
    }
    const views = await read(lopsided, [OPEN])
    expect(views.get(keyOf(OPEN))).toEqual({ state: 'blocked' })
  })

  it('gives nothing for a short key no page of the site carries', async () => {
    const key = `/d/${aShortId(999)}`
    const views = await readInternalLinkPreviews(deps, {
      viewer: await siteWith([OPEN]),
      keys: [key],
    })
    expect(views.get(key)).toEqual({ state: 'blocked' })
  })

  it('describes a published page only when asked', async () => {
    const views = await read(await siteWith([OPEN]), [OPEN], true)
    expect(readyOf(views, OPEN).description).toBe('About 201.')
  })

  it('does not accept a reference that is not one', async () => {
    const views = await readInternalLinkPreviews(deps, {
      viewer: await siteWith([OPEN]),
      keys: ['/d/!!!'],
    })
    expect(views.get('/d/!!!')).toEqual({ state: 'blocked' })
  })
})
