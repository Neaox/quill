import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, revisionId, shortId, userId, userPrincipal, workspaceId } from '@quill/domain'
import type { DocumentId, Principal, ShortId } from '@quill/domain'

import { defaultOrganisationSettings } from '../settings/documents.ts'
import { encodeSettings } from '../settings/yaml.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createFakeSettings } from '../test-support/fake-settings.ts'
import type { FakeSettings } from '../test-support/fake-settings.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createGrant } from './create-grant.ts'
import type { PublicNavigationNode, PublicSiteDependencies } from './public-site.ts'
import { loadReaderPreview } from './reader-preview.ts'

/**
 * The reader preview: any document a member may read, set in the public
 * site's chrome, with the navigation the public site would build — whether or
 * not anything is published to the web.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OVERVIEW = documentId('00000000-0000-4000-8000-000000000201')
const TOKENS = documentId('00000000-0000-4000-8000-000000000202')
const DRAFT = documentId('00000000-0000-4000-8000-000000000203')
const PRIVATE = documentId('00000000-0000-4000-8000-000000000204')
const RUNBOOK = documentId('00000000-0000-4000-8000-000000000205')
const ADMIN = userId('00000000-0000-4000-8000-000000000001')
const READER = userId('00000000-0000-4000-8000-000000000002')

const READER_IDENTITIES: readonly Principal[] = [userPrincipal(READER), { kind: 'public' }]

let uow: InMemoryUnitOfWork
let settings: FakeSettings
let deps: PublicSiteDependencies

const key = (n: number): ShortId => shortId(`k${n.toString().padStart(9, '0')}`)

async function seedDocument(
  id: DocumentId,
  index: number,
  title: string,
  collectionId: string,
  options: { readonly parentId?: DocumentId; readonly published?: boolean } = {},
): Promise<void> {
  await uow.repos.documents.create({
    id,
    shortId: key(index),
    workspaceId: WORKSPACE,
    collectionId,
    parentId: options.parentId ?? null,
    slug: `document-${index}`,
    path: `${collectionId}/document-${index}.md`,
    title,
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: new Date(NOW.getTime() + index * 1000),
  })
  if (options.published === false) return
  await uow.repos.documents.update(
    id,
    { headRevision: revisionId(index.toString(16).padStart(40, '0')) },
    NOW,
  )
}

function placeSettings(publicPublishingAllowed: boolean): void {
  settings.place(
    'organisation',
    encodeSettings({
      ...defaultOrganisationSettings(),
      name: 'Acme',
      policies: { ...defaultOrganisationSettings().policies, publicPublishingAllowed },
    }),
  )
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  settings = createFakeSettings()
  deps = { uow, settings, clock: createFakeClock(NOW), ids: createFakeIdGenerator() }
  placeSettings(true)

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
    ['guides', 'Guides'],
    ['runbooks', 'Runbooks'],
    ['empty', 'Empty'],
  ] as const) {
    await uow.repos.collections.create({ id, workspaceId: WORKSPACE, name, slug: id, now: NOW })
  }

  await seedDocument(OVERVIEW, 1, 'Overview', 'guides')
  await seedDocument(TOKENS, 2, 'Token exchange', 'guides', { parentId: OVERVIEW })
  await seedDocument(DRAFT, 3, 'Half written', 'guides', { published: false })
  await seedDocument(PRIVATE, 4, 'Salaries', 'guides')
  await seedDocument(RUNBOOK, 5, 'On call', 'runbooks')

  await createGrant(deps, {
    principalKind: 'user',
    principalId: READER,
    scopeKind: 'workspace',
    scopeId: WORKSPACE,
    role: 'viewer',
    effect: 'allow',
    createdBy: ADMIN,
  })
  await createGrant(deps, {
    principalKind: 'user',
    principalId: READER,
    scopeKind: 'document',
    scopeId: PRIVATE,
    role: 'viewer',
    effect: 'deny',
    createdBy: ADMIN,
  })
})

async function preview(document: DocumentId = OVERVIEW, seesEverything = false) {
  const loaded = await loadReaderPreview(deps, {
    documentId: document,
    identities: READER_IDENTITIES,
    seesEverything,
  })
  if (loaded.kind !== 'preview') throw new Error(`expected a preview, got ${loaded.kind}`)
  return loaded.preview
}

const titles = (nodes: readonly PublicNavigationNode[]): unknown =>
  nodes.map((node) => ({ title: node.title, path: node.path, children: titles(node.children) }))

describe('loading a reader preview', () => {
  it('answers with the document, its collection, its workspace and the organisation', async () => {
    const loaded = await preview()
    expect(loaded.document.id).toBe(OVERVIEW)
    expect(loaded.collection.name).toBe('Guides')
    expect(loaded.workspace.slug).toBe('engineering')
    expect(loaded.organisation.name).toBe('Acme')
  })

  it('builds one section per collection, as the public site would, keyed by readable reference', async () => {
    const loaded = await preview()
    expect(loaded.sections.map((section) => section.collection.name)).toEqual([
      'Guides',
      'Runbooks',
    ])
    expect(titles(loaded.sections[0]?.navigation ?? [])).toEqual([
      {
        title: 'Overview',
        path: 'overview-k000000001',
        children: [{ title: 'Token exchange', path: 'token-exchange-k000000002', children: [] }],
      },
    ])
  })

  it('leaves out what has never been published, and what this reader may not see', async () => {
    const all = JSON.stringify((await preview()).sections.map((section) => section.navigation))
    expect(all).not.toContain('Half written')
    expect(all).not.toContain('Salaries')
  })

  it('shows an instance admin everything that is published', async () => {
    const all = JSON.stringify(
      (await preview(OVERVIEW, true)).sections.map((section) => section.navigation),
    )
    expect(all).toContain('Salaries')
    expect(all).not.toContain('Half written')
  })

  it('keeps the document’s own collection even when nothing else in it is published', async () => {
    const loaded = await preview(DRAFT)
    expect(loaded.collection.name).toBe('Guides')
    expect(loaded.sections.map((section) => section.collection.id)).toContain('guides')
  })

  it('says the page is not on the web when its collection is not published', async () => {
    expect((await preview()).publicAddress).toBeNull()
  })

  it('names the public address when the page is live on the web', async () => {
    await uow.repos.collections.setPublicSite('guides', {
      enabled: true,
      siteSlug: 'acme-docs',
      homeDocumentId: null,
    })
    await createGrant(deps, {
      principalKind: 'public',
      principalId: null,
      scopeKind: 'collection',
      scopeId: 'guides',
      role: 'viewer',
      effect: 'allow',
      createdBy: ADMIN,
    })
    expect((await preview()).publicAddress).toEqual({
      siteSlug: 'acme-docs',
      path: 'guides/overview',
    })
    // A page with no published revision is not on the site, whatever its collection is.
    expect((await preview(DRAFT)).publicAddress).toBeNull()

    placeSettings(false)
    expect((await preview()).publicAddress).toBeNull()
  })

  it('answers not found for a document that is not there', async () => {
    const loaded = await loadReaderPreview(deps, {
      documentId: documentId('00000000-0000-4000-8000-000000000999'),
      identities: READER_IDENTITIES,
      seesEverything: false,
    })
    expect(loaded).toEqual({ kind: 'not-found' })
  })

  it('refuses to guess at a theme when the organisation’s settings cannot be read', async () => {
    settings.place('organisation', 'version: 99\n')
    const loaded = await loadReaderPreview(deps, {
      documentId: OVERVIEW,
      identities: READER_IDENTITIES,
      seesEverything: false,
    })
    expect(loaded).toEqual({ kind: 'settings-unreadable' })
  })
})
