import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, revisionId, shortId, userId, workspaceId } from '@quill/domain'
import type { DocumentId, ShortId } from '@quill/domain'

import { defaultOrganisationSettings } from '../settings/documents.ts'
import { encodeSettings } from '../settings/yaml.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createFakeSettings } from '../test-support/fake-settings.ts'
import type { FakeSettings } from '../test-support/fake-settings.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createGrant } from './create-grant.ts'
import {
  loadPublicSite,
  publicDocumentPaths,
  publicPageHref,
  publicSiteHref,
  publishedAt,
} from './public-site.ts'
import type { PublicNavigationNode, PublicSiteDependencies } from './public-site.ts'

/**
 * What a public site is made of, and the three things that must never be on
 * one: a draft, a document this reader has no grant for, and a site the
 * organisation has stopped allowing.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OVERVIEW = documentId('00000000-0000-4000-8000-000000000201')
const AUTHENTICATION = documentId('00000000-0000-4000-8000-000000000202')
const TOKENS = documentId('00000000-0000-4000-8000-000000000203')
const SECRET = documentId('00000000-0000-4000-8000-000000000204')
const UNPUBLISHED = documentId('00000000-0000-4000-8000-000000000205')
const ADMIN = userId('00000000-0000-4000-8000-000000000001')

const GUIDES = 'guides'

let uow: InMemoryUnitOfWork
let settings: FakeSettings
let deps: PublicSiteDependencies

const key = (n: number): ShortId => shortId(`k${n.toString().padStart(9, '0')}`)

interface SeedDocument {
  readonly id: DocumentId
  readonly title: string
  readonly parentId?: DocumentId
  readonly published?: boolean
  readonly createdAt?: Date
}

async function seedDocument(document: SeedDocument, index: number): Promise<void> {
  const created = await uow.repos.documents.create({
    id: document.id,
    shortId: key(index),
    workspaceId: WORKSPACE,
    collectionId: GUIDES,
    parentId: document.parentId ?? null,
    slug: `document-${index}`,
    path: `guides/document-${index}.md`,
    title: document.title,
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: document.createdAt ?? new Date(NOW.getTime() + index * 1000),
  })
  if (document.published === false) return
  const revision = revisionId(index.toString(16).padStart(40, '0'))
  await uow.repos.documents.update(created.id, { headRevision: revision }, NOW)
  await uow.repos.revisions.append({
    id: `revision-${index}`,
    documentId: created.id,
    workspaceId: WORKSPACE,
    revision,
    authorName: 'Editor',
    authorEmail: 'editor@example.com',
    timestamp: new Date(NOW.getTime() + index * 60_000),
    summary: document.title,
    changeNote: null,
    now: NOW,
  })
}

/** The whole instance a public site needs: a unit, a workspace, a collection, five documents. */
async function seed(): Promise<void> {
  uow = createInMemoryUnitOfWork()
  settings = createFakeSettings()
  deps = { uow, settings, clock: createFakeClock(NOW), ids: createFakeIdGenerator() }

  settings.place(
    'organisation',
    encodeSettings({
      ...defaultOrganisationSettings(),
      name: 'Acme',
      policies: { ...defaultOrganisationSettings().policies, publicPublishingAllowed: true },
    }),
  )

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
    id: GUIDES,
    workspaceId: WORKSPACE,
    name: 'Guides',
    slug: 'guides',
    now: NOW,
  })

  const documents: readonly SeedDocument[] = [
    { id: OVERVIEW, title: 'Overview' },
    { id: AUTHENTICATION, title: 'Authentication' },
    { id: TOKENS, title: 'Token exchange', parentId: AUTHENTICATION },
    { id: SECRET, title: 'Salaries' },
    { id: UNPUBLISHED, title: 'Half written', published: false },
  ]
  for (const [index, document] of documents.entries()) await seedDocument(document, index + 1)

  await uow.repos.collections.setPublicSite(GUIDES, {
    enabled: true,
    siteSlug: 'acme-docs',
    homeDocumentId: null,
  })
  await createGrant(deps, {
    principalKind: 'public',
    principalId: null,
    scopeKind: 'collection',
    scopeId: GUIDES,
    role: 'viewer',
    effect: 'allow',
    createdBy: ADMIN,
  })
}

beforeEach(seed)

/** The site, or a failed expectation naming what came back instead. */
async function site(slug = 'acme-docs') {
  const loaded = await loadPublicSite(deps, slug)
  if (loaded.kind !== 'site') throw new Error(`expected a site, got ${loaded.kind}`)
  return loaded.site
}

const titles = (nodes: readonly PublicNavigationNode[]): unknown =>
  nodes.map((node) => ({ title: node.title, path: node.path, children: titles(node.children) }))

describe('publicDocumentPaths', () => {
  const document = (id: string, title: string, created: number, shortKey = 'aaaaaaaaaa') => ({
    id: id as DocumentId,
    shortId: shortKey,
    title,
    createdAt: new Date(NOW.getTime() + created),
  })

  it('builds the collection slug and the title slug', () => {
    const paths = publicDocumentPaths({ slug: 'guides' }, [document('a', 'Rate limits', 0)])
    expect(paths.get('a' as DocumentId)).toBe('guides/rate-limits')
  })

  it('falls back to the short key when a title slugifies to nothing', () => {
    const paths = publicDocumentPaths({ slug: 'guides' }, [document('a', '***', 0, 'k0000000z1')])
    expect(paths.get('a' as DocumentId)).toBe('guides/k0000000z1')
  })

  it('gives the earliest of two colliding titles the plain address', () => {
    const paths = publicDocumentPaths({ slug: 'guides' }, [
      document('later', 'Set up', 5_000, 'k0000000z2'),
      document('earlier', 'Set-up', 0, 'k0000000z1'),
    ])
    expect(paths.get('earlier' as DocumentId)).toBe('guides/set-up')
    expect(paths.get('later' as DocumentId)).toBe('guides/set-up-k0000000z2')
  })

  it('breaks a tie on creation time by id, so the table is never a function of query order', () => {
    const one = publicDocumentPaths({ slug: 'g' }, [
      document('b', 'Same', 0, 'k0000000z2'),
      document('a', 'Same', 0, 'k0000000z1'),
    ])
    const two = publicDocumentPaths({ slug: 'g' }, [
      document('a', 'Same', 0, 'k0000000z1'),
      document('b', 'Same', 0, 'k0000000z2'),
    ])
    expect([...one]).toEqual([...two])
  })
})

describe('loading a public site', () => {
  it('answers with the collection, its navigation and its addresses', async () => {
    const loaded = await site()
    expect(loaded.siteSlug).toBe('acme-docs')
    expect(loaded.collection.name).toBe('Guides')
    expect(loaded.organisation.name).toBe('Acme')
    expect(titles(loaded.navigation)).toEqual([
      {
        title: 'Authentication',
        path: 'guides/authentication',
        children: [{ title: 'Token exchange', path: 'guides/token-exchange', children: [] }],
      },
      { title: 'Overview', path: 'guides/overview', children: [] },
      { title: 'Salaries', path: 'guides/salaries', children: [] },
    ])
    expect(loaded.pages.get('guides/authentication')?.id).toBe(AUTHENTICATION)
  })

  it('leaves a document with no published revision off the site entirely', async () => {
    const loaded = await site()
    expect(loaded.pages.has('guides/half-written')).toBe(false)
    expect(JSON.stringify(loaded.navigation)).not.toContain('Half written')
  })

  it('leaves a document denied to the public off the navigation, the pages and nothing else', async () => {
    await createGrant(deps, {
      principalKind: 'public',
      principalId: null,
      scopeKind: 'document',
      scopeId: SECRET,
      role: 'viewer',
      effect: 'deny',
      createdBy: ADMIN,
    })
    const loaded = await site()
    expect(loaded.pages.has('guides/salaries')).toBe(false)
    expect(titles(loaded.navigation)).not.toContainEqual(
      expect.objectContaining({ title: 'Salaries' }),
    )
    // Its address is still reserved, so carving it out never moves anybody else.
    expect(loaded.pathById.get(SECRET)).toBe('guides/salaries')
  })

  it('carves out everything below a denied page, because a deny holds downwards', async () => {
    await createGrant(deps, {
      principalKind: 'public',
      principalId: null,
      scopeKind: 'document',
      scopeId: AUTHENTICATION,
      role: 'viewer',
      effect: 'deny',
      createdBy: ADMIN,
    })
    const loaded = await site()
    expect([...loaded.pages.keys()]).toEqual(['guides/overview', 'guides/salaries'])
  })

  it('lifts a page whose parent has never been published, rather than losing it', async () => {
    await uow.repos.documents.update(AUTHENTICATION, { headRevision: null }, NOW)
    const loaded = await site()
    expect(titles(loaded.navigation)).toContainEqual(
      expect.objectContaining({ title: 'Token exchange', path: 'guides/token-exchange' }),
    )
  })

  it('shows the collection home document when one is set', async () => {
    await uow.repos.collections.setPublicSite(GUIDES, {
      enabled: true,
      siteSlug: 'acme-docs',
      homeDocumentId: OVERVIEW,
    })
    expect((await site()).home?.id).toBe(OVERVIEW)
  })

  it('falls back to the index when the home document is not on the site', async () => {
    await uow.repos.collections.setPublicSite(GUIDES, {
      enabled: true,
      siteSlug: 'acme-docs',
      homeDocumentId: UNPUBLISHED,
    })
    expect((await site()).home).toBeNull()
  })

  it('answers with an empty site when nothing in the collection is published yet', async () => {
    for (const id of [OVERVIEW, AUTHENTICATION, TOKENS, SECRET]) {
      await uow.repos.documents.update(id, { headRevision: null }, NOW)
    }
    const loaded = await site()
    expect(loaded.navigation).toEqual([])
    expect(loaded.pages.size).toBe(0)
  })

  it('refuses an unknown slug', async () => {
    expect(await loadPublicSite(deps, 'nobody')).toEqual({ kind: 'not-found' })
  })

  it('refuses a site whose switch is off, without forgetting its address', async () => {
    await uow.repos.collections.setPublicSite(GUIDES, {
      enabled: false,
      siteSlug: 'acme-docs',
      homeDocumentId: null,
    })
    expect(await loadPublicSite(deps, 'acme-docs')).toEqual({ kind: 'not-found' })
    expect((await uow.repos.collections.findBySiteSlug('acme-docs'))?.id).toBe(GUIDES)
  })

  it('refuses every site when the organisation no longer allows publishing', async () => {
    settings.place('organisation', encodeSettings(defaultOrganisationSettings()))
    expect(await loadPublicSite(deps, 'acme-docs')).toEqual({ kind: 'not-found' })
  })

  it('refuses every site when the organisation settings cannot be read', async () => {
    settings.place('organisation', 'version: 99\n')
    expect(await loadPublicSite(deps, 'acme-docs')).toEqual({ kind: 'not-found' })
  })
})

describe('publishedAt', () => {
  it('answers with the head revision’s timestamp, in one query', async () => {
    const loaded = await site()
    const pages = [...loaded.pages.values()]
    const stamps = await publishedAt(deps, pages)
    expect(stamps.get(AUTHENTICATION)).toEqual(new Date(NOW.getTime() + 2 * 60_000))
    expect(stamps.size).toBe(pages.length)
  })

  /**
   * `lastmod` is when the page last changed, so a document that has been
   * published more than once is stamped with its newest revision and not with
   * whichever one the index happens to answer with first.
   */
  it('answers with the newest revision of a document that has several', async () => {
    const republished = new Date(NOW.getTime() + 5 * 60 * 60_000)
    await uow.repos.revisions.append({
      id: 'revision-2-again',
      documentId: AUTHENTICATION,
      workspaceId: WORKSPACE,
      revision: revisionId('b'.repeat(40)),
      authorName: 'Editor',
      authorEmail: 'editor@example.com',
      timestamp: republished,
      summary: 'Authentication, again',
      changeNote: null,
      now: NOW,
    })

    const loaded = await site()
    const stamps = await publishedAt(deps, [...loaded.pages.values()])
    expect(stamps.get(AUTHENTICATION)).toEqual(republished)
    // And the older revision of the same document is not a second answer.
    expect(stamps.size).toBe(loaded.pages.size)
  })

  /**
   * A document restored from files before a reindex has a head revision the
   * index has no row for. Its own stamp is the best date available, and a
   * sitemap entry with no `lastmod` would be worse than one that is a little
   * generous.
   */
  it('falls back to the row’s own stamp for a document the index has no row for', async () => {
    const loaded = await site()
    const orphan = loaded.pages.get('guides/overview')
    expect(orphan).toBeDefined()
    const empty = createInMemoryUnitOfWork()
    const stamps = await publishedAt({ uow: empty }, orphan === undefined ? [] : [orphan])
    expect(stamps.get(OVERVIEW)).toEqual(orphan?.updatedAt)
  })
})

describe('addresses', () => {
  it('are built in one place', () => {
    expect(publicSiteHref('acme-docs')).toBe('/s/acme-docs')
    expect(publicPageHref('acme-docs', 'guides/overview')).toBe('/s/acme-docs/guides/overview')
  })
})
