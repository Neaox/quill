import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { documentId, revisionId, shortId, userId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { defaultOrganisationSettings } from '../settings/documents.ts'
import type { PublicMenu } from '../settings/public-menu.ts'
import { encodeSettings } from '../settings/yaml.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createFakeSettings } from '../test-support/fake-settings.ts'
import type { FakeSettings } from '../test-support/fake-settings.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createGrant } from './create-grant.ts'
import {
  describeMenuTargets,
  findCollectionCandidates,
  resolvePublicMenu,
  type PublicMenuDependencies,
  type PublicSiteLoader,
} from './public-menu.ts'
import { loadPublicSite } from './public-site.ts'
import type { PublicSiteDependencies } from './public-site.ts'

/**
 * The menu names documents and collections by id; a reader is shown what is
 * on the public web today, by its current title and at its current address,
 * and nothing that would answer 404.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const ADMIN = userId('00000000-0000-4000-8000-000000000001')

const GUIDES = '00000000-0000-4000-8000-000000000301'
const API = '00000000-0000-4000-8000-000000000302'
const INTERNAL = '00000000-0000-4000-8000-000000000303'

const OVERVIEW = documentId('00000000-0000-4000-8000-000000000201')
const DRAFT = documentId('00000000-0000-4000-8000-000000000202')
const SALARIES = documentId('00000000-0000-4000-8000-000000000203')
const REFERENCE = documentId('00000000-0000-4000-8000-000000000204')
const CARVED_OUT = documentId('00000000-0000-4000-8000-000000000205')
const UNFILED = documentId('00000000-0000-4000-8000-000000000206')
const DELETED = '00000000-0000-4000-8000-0000000002ff'

let uow: InMemoryUnitOfWork
let settings: FakeSettings
let site: PublicSiteDependencies
let deps: PublicMenuDependencies
let loadSite: Mock<PublicSiteLoader>

function organisation(publicPublishingAllowed = true): string {
  const defaults = defaultOrganisationSettings()
  return encodeSettings({
    ...defaults,
    name: 'Acme',
    policies: { ...defaults.policies, publicPublishingAllowed },
  })
}

async function seedDocument(
  id: DocumentId,
  collectionId: string | null,
  title: string,
  index: number,
  published = true,
): Promise<void> {
  await uow.repos.documents.create({
    id,
    shortId: shortId(`k${index.toString().padStart(9, '0')}`),
    workspaceId: WORKSPACE,
    collectionId,
    parentId: null,
    slug: `document-${index}`,
    path: `document-${index}.md`,
    title,
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: new Date(NOW.getTime() + index * 1000),
  })
  if (!published) return
  await uow.repos.documents.update(
    id,
    { headRevision: revisionId(index.toString(16).padStart(40, '0')) },
    NOW,
  )
}

async function publicGrant(
  scopeKind: 'collection' | 'document',
  scopeId: string,
  effect: 'allow' | 'deny' = 'allow',
) {
  await createGrant(site, {
    principalKind: 'public',
    principalId: null,
    scopeKind,
    scopeId,
    role: 'viewer',
    effect,
    createdBy: ADMIN,
  })
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  settings = createFakeSettings()
  site = { uow, settings, clock: createFakeClock(NOW), ids: createFakeIdGenerator() }
  loadSite = vi.fn<PublicSiteLoader>(async (slug) => {
    const loaded = await loadPublicSite(site, slug)
    return loaded.kind === 'site' ? loaded.site : null
  })
  deps = { uow, loadSite }
  settings.place('organisation', organisation())

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
    [GUIDES, 'Guides'],
    [API, 'API reference'],
    [INTERNAL, 'Internal'],
  ] as const) {
    await uow.repos.collections.create({
      id,
      workspaceId: WORKSPACE,
      name,
      slug: name.toLowerCase().replaceAll(' ', '-'),
      now: NOW,
    })
  }
  await seedDocument(OVERVIEW, GUIDES, 'Overview', 1)
  await seedDocument(DRAFT, GUIDES, 'Half written', 2, false)
  await seedDocument(SALARIES, INTERNAL, 'Salaries', 3)
  await seedDocument(REFERENCE, API, 'Endpoints', 4)
  await seedDocument(CARVED_OUT, GUIDES, 'Carved out', 5)
  await seedDocument(UNFILED, null, 'Loose notes', 6)

  await uow.repos.collections.setPublicSite(GUIDES, {
    enabled: true,
    siteSlug: 'acme-docs',
    homeDocumentId: null,
  })
  await uow.repos.collections.setPublicSite(API, {
    enabled: true,
    siteSlug: 'acme-api',
    homeDocumentId: null,
  })
  await publicGrant('collection', GUIDES)
  await publicGrant('collection', API)
  await publicGrant('document', CARVED_OUT, 'deny')
})

const doc = (id: string, label?: string) =>
  ({ kind: 'document', id, ...(label === undefined ? {} : { label }) }) as const

describe('resolvePublicMenu', () => {
  it('links a public document by its current title and address', async () => {
    expect(await resolvePublicMenu(deps, [doc(OVERVIEW)])).toEqual([
      {
        kind: 'link',
        link: {
          label: 'Overview',
          href: '/s/acme-docs/guides/overview',
          external: false,
          referrer: 'hidden',
        },
      },
    ])
  })

  it('follows a rename: the next resolution has the new title and the new address', async () => {
    await uow.repos.documents.update(OVERVIEW, { title: 'Getting started' }, NOW)
    expect(await resolvePublicMenu(deps, [doc(OVERVIEW)])).toEqual([
      {
        kind: 'link',
        link: {
          label: 'Getting started',
          href: '/s/acme-docs/guides/getting-started',
          external: false,
          referrer: 'hidden',
        },
      },
    ])
  })

  it('keeps an administrator’s label over the title, and still follows the address', async () => {
    await uow.repos.documents.update(OVERVIEW, { title: 'Getting started' }, NOW)
    expect(await resolvePublicMenu(deps, [doc(OVERVIEW, 'Start here')])).toEqual([
      {
        kind: 'link',
        link: {
          label: 'Start here',
          href: '/s/acme-docs/guides/getting-started',
          external: false,
          referrer: 'hidden',
        },
      },
    ])
  })

  it('follows a move to another public site', async () => {
    await uow.repos.documents.update(OVERVIEW, { collectionId: API }, NOW)
    const [item] = await resolvePublicMenu(deps, [doc(OVERVIEW)])
    expect(item).toEqual({
      kind: 'link',
      link: {
        label: 'Overview',
        href: '/s/acme-api/api-reference/overview',
        external: false,
        referrer: 'hidden',
      },
    })
  })

  it('leaves out what would answer 404: deleted, draft, private, carved out, in no collection, moved somewhere private', async () => {
    expect(
      await resolvePublicMenu(deps, [
        doc(DELETED),
        doc(DRAFT),
        doc(SALARIES),
        doc(CARVED_OUT),
        doc(UNFILED),
      ]),
    ).toEqual([])
    await uow.repos.documents.update(OVERVIEW, { collectionId: INTERNAL }, NOW)
    expect(await resolvePublicMenu(deps, [doc(OVERVIEW)])).toEqual([])
  })

  it('links a collection to its site, by its current name, while the site is on', async () => {
    const menu: PublicMenu = [{ kind: 'collection', id: API }]
    expect(await resolvePublicMenu(deps, menu)).toEqual([
      {
        kind: 'link',
        link: { label: 'API reference', href: '/s/acme-api', external: false, referrer: 'hidden' },
      },
    ])
    await uow.repos.collections.rename(API, 'API')
    expect(await resolvePublicMenu(deps, menu)).toMatchObject([{ link: { label: 'API' } }])

    await uow.repos.collections.setPublicSite(API, {
      enabled: false,
      siteSlug: 'acme-api',
      homeDocumentId: null,
    })
    expect(await resolvePublicMenu(deps, menu)).toEqual([])
    expect(await resolvePublicMenu(deps, [{ kind: 'collection', id: INTERNAL }])).toEqual([])
  })

  it('always keeps an address link, marking the ones that leave the site', async () => {
    expect(
      await resolvePublicMenu(deps, [
        { kind: 'url', href: 'https://status.example.com', label: 'Status' },
        { kind: 'url', href: '/s/acme-docs/search', label: 'Search' },
      ]),
    ).toEqual([
      {
        kind: 'link',
        link: {
          label: 'Status',
          href: 'https://status.example.com',
          external: true,
          referrer: 'hidden',
        },
      },
      {
        kind: 'link',
        link: { label: 'Search', href: '/s/acme-docs/search', external: false, referrer: 'hidden' },
      },
    ])
  })

  it('tells an external destination where the reader came from only when the administrator says so', async () => {
    const [sent, hidden] = await resolvePublicMenu(deps, [
      { kind: 'url', href: 'https://partner.example.com', label: 'Partner', referrer: 'sent' },
      { kind: 'url', href: 'https://other.example.com', label: 'Other', referrer: 'hidden' },
    ])
    expect(sent).toMatchObject({ link: { external: true, referrer: 'sent' } })
    expect(hidden).toMatchObject({ link: { external: true, referrer: 'hidden' } })
  })

  it('keeps a dropdown with what is left in it, and drops one left empty', async () => {
    expect(
      await resolvePublicMenu(deps, [
        { kind: 'group', label: 'Guides', items: [doc(OVERVIEW), doc(DELETED)] },
        { kind: 'group', label: 'Private', items: [doc(SALARIES), doc(DRAFT)] },
      ]),
    ).toEqual([
      {
        kind: 'group',
        label: 'Guides',
        links: [
          {
            label: 'Overview',
            href: '/s/acme-docs/guides/overview',
            external: false,
            referrer: 'hidden',
          },
        ],
      },
    ])
  })

  it('links only addresses when the organisation does not publish', async () => {
    settings.place('organisation', organisation(false))
    expect(
      await resolvePublicMenu(deps, [
        doc(OVERVIEW),
        { kind: 'collection', id: GUIDES },
        { kind: 'url', href: 'https://status.example.com', label: 'Status' },
      ]),
    ).toEqual([
      {
        kind: 'link',
        link: {
          label: 'Status',
          href: 'https://status.example.com',
          external: true,
          referrer: 'hidden',
        },
      },
    ])
  })

  it('reads every document in one query, and each site once, however many links name them', async () => {
    const listByIds = vi.spyOn(uow.repos.documents, 'listByIds')
    const findById = vi.spyOn(uow.repos.documents, 'findById')
    const listPublicSites = vi.spyOn(uow.repos.collections, 'listPublicSites')
    const many: PublicMenu = [
      doc(OVERVIEW),
      doc(OVERVIEW, 'Again'),
      { kind: 'collection', id: GUIDES },
      {
        kind: 'group',
        label: 'Everything',
        items: [doc(REFERENCE), doc(SALARIES), doc(DRAFT), { kind: 'collection', id: API }],
      },
    ]
    await resolvePublicMenu(deps, many)
    expect(listByIds).toHaveBeenCalledTimes(1)
    expect(listByIds.mock.calls[0]?.[0]).toHaveLength(4)
    expect(findById).not.toHaveBeenCalled()
    expect(listPublicSites).toHaveBeenCalledTimes(1)
    expect(loadSite.mock.calls.map(([slug]) => slug).toSorted()).toEqual(['acme-api', 'acme-docs'])
  })

  it('reads nothing at all for a menu of addresses', async () => {
    const listPublicSites = vi.spyOn(uow.repos.collections, 'listPublicSites')
    await resolvePublicMenu(deps, [{ kind: 'url', href: '/a', label: 'A' }])
    expect(listPublicSites).not.toHaveBeenCalled()
    expect(loadSite).not.toHaveBeenCalled()
  })
})

describe('describeMenuTargets', () => {
  it('says what each target is called, where it sits, and whether a reader sees it', async () => {
    expect(
      await describeMenuTargets(deps, {
        documents: [OVERVIEW, SALARIES, UNFILED, DELETED, 'not-an-id'],
        collections: [API, INTERNAL, DELETED],
      }),
    ).toEqual([
      {
        kind: 'document',
        id: OVERVIEW,
        status: 'public',
        title: 'Overview',
        workspaceName: 'Engineering',
        collectionName: 'Guides',
        href: '/s/acme-docs/guides/overview',
      },
      {
        kind: 'document',
        id: SALARIES,
        status: 'not-public',
        title: 'Salaries',
        workspaceName: 'Engineering',
        collectionName: 'Internal',
        href: null,
      },
      {
        kind: 'document',
        id: UNFILED,
        status: 'not-public',
        title: 'Loose notes',
        workspaceName: 'Engineering',
        collectionName: null,
        href: null,
      },
      expect.objectContaining({ id: DELETED, kind: 'document', status: 'missing', title: null }),
      expect.objectContaining({ id: 'not-an-id', status: 'missing' }),
      {
        kind: 'collection',
        id: API,
        status: 'public',
        title: 'API reference',
        workspaceName: 'Engineering',
        collectionName: null,
        href: '/s/acme-api',
      },
      expect.objectContaining({ id: INTERNAL, status: 'not-public', title: 'Internal' }),
      expect.objectContaining({ id: DELETED, kind: 'collection', status: 'missing' }),
    ])
  })
})

describe('findCollectionCandidates', () => {
  it('finds collections in any workspace by a fragment of the name', async () => {
    expect(await findCollectionCandidates(deps, ' ref', 10)).toEqual([
      { id: API, name: 'API reference', workspaceName: 'Engineering', isPublic: true },
    ])
    expect((await findCollectionCandidates(deps, 'n', 10)).map((row) => row.name)).toEqual([
      'API reference',
      'Internal',
    ])
  })
})
