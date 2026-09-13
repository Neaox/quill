import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, revisionId, userId, workspaceId } from '@quill/domain'

import { defaultOrganisationSettings } from '../settings/documents.ts'
import { encodeSettings } from '../settings/yaml.ts'
import { aShortId, createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createFakeSettings } from '../test-support/fake-settings.ts'
import type { FakeSettings } from '../test-support/fake-settings.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import {
  publishCollection,
  PUBLIC_PUBLISHING_AUDIT_EVENTS,
  unpublishCollection,
} from './publish-collection.ts'
import type { PublishCollectionDependencies } from './publish-collection.ts'

/**
 * Publishing a collection writes two things — the address on the collection,
 * and a viewer grant to the public principal — and the policy decides whether
 * it may happen at all.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER_WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000102')
const ADMIN = userId('00000000-0000-4000-8000-000000000001')
const HOME = documentId('00000000-0000-4000-8000-000000000201')
const ELSEWHERE = documentId('00000000-0000-4000-8000-000000000202')

let uow: InMemoryUnitOfWork
let settings: FakeSettings
let deps: PublishCollectionDependencies

const allowing = (allowed: boolean): string =>
  encodeSettings({
    ...defaultOrganisationSettings(),
    policies: { ...defaultOrganisationSettings().policies, publicPublishingAllowed: allowed },
  })

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  settings = createFakeSettings()
  deps = { uow, settings, clock: createFakeClock(NOW), ids: createFakeIdGenerator() }
  settings.place('organisation', allowing(true))

  for (const [id, unit] of [
    [WORKSPACE, 'acme'],
    [OTHER_WORKSPACE, 'acme'],
  ] as const) {
    await uow.repos.workspaces.create({ id, unitId: unit, name: 'Engineering', slug: id, now: NOW })
  }
  await uow.repos.collections.create({
    id: 'guides',
    workspaceId: WORKSPACE,
    name: 'Developer guides',
    slug: 'developer-guides',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'runbooks',
    workspaceId: OTHER_WORKSPACE,
    name: 'Runbooks',
    slug: 'runbooks',
    now: NOW,
  })
  for (const [id, collection] of [
    [HOME, 'guides'],
    [ELSEWHERE, 'runbooks'],
  ] as const) {
    await uow.repos.documents.create({
      id,
      shortId: aShortId(),
      workspaceId: collection === 'guides' ? WORKSPACE : OTHER_WORKSPACE,
      collectionId: collection,
      parentId: null,
      slug: 'a-page',
      path: `${collection}/a-page.md`,
      title: 'A page',
      status: 'published',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
  }
  // A home document has to be published before a site can show it.
  await uow.repos.documents.update(HOME, { headRevision: revisionId('a'.repeat(40)) }, NOW)
})

const publish = (command: Partial<Parameters<typeof publishCollection>[1]> = {}) =>
  publishCollection(deps, { collectionId: 'guides', publishedBy: ADMIN, ...command })

const publicGrants = async () =>
  (await uow.repos.grants.listForScope('collection', 'guides')).filter(
    (grant) => grant.principalKind === 'public',
  )

describe('publishing a collection', () => {
  it('takes its address from the collection name, and grants the public principal viewer', async () => {
    const result = await publish()
    expect(result).toMatchObject({
      kind: 'published',
      collection: {
        publicSite: { enabled: true, siteSlug: 'developer-guides', homeDocumentId: null },
      },
    })
    expect(await publicGrants()).toEqual([
      expect.objectContaining({ scopeKind: 'collection', role: 'viewer', effect: 'allow' }),
    ])
  })

  it('takes an address the caller chose, slugified', async () => {
    const result = await publish({ siteSlug: 'Acme Developer Docs' })
    expect(result).toMatchObject({
      kind: 'published',
      collection: { publicSite: { siteSlug: 'acme-developer-docs' } },
    })
  })

  it('writes an audit row naming the address', async () => {
    await publish({ siteSlug: 'acme-docs' })
    expect(uow.auditEvents).toContainEqual(
      expect.objectContaining({
        type: PUBLIC_PUBLISHING_AUDIT_EVENTS.published,
        actorUserId: ADMIN,
        targetType: 'collection',
        targetId: 'guides',
        metadata: expect.objectContaining({ siteSlug: 'acme-docs' }),
      }),
    )
  })

  it('does not write a second grant when it is already published', async () => {
    await publish()
    await publish()
    expect(await publicGrants()).toHaveLength(1)
  })

  it('keeps the home document a republish did not mention', async () => {
    await publish({ homeDocumentId: HOME })
    const again = await publish({ siteSlug: 'moved' })
    expect(again).toMatchObject({
      kind: 'published',
      collection: { publicSite: { siteSlug: 'moved', homeDocumentId: HOME } },
    })
  })

  it('clears the home document when the caller states null', async () => {
    await publish({ homeDocumentId: HOME })
    expect(await publish({ homeDocumentId: null })).toMatchObject({
      kind: 'published',
      collection: { publicSite: { homeDocumentId: null } },
    })
  })

  it('keeps the address it already had when a republish names none', async () => {
    await publish({ siteSlug: 'acme-docs' })
    expect(await publish()).toMatchObject({
      kind: 'published',
      collection: { publicSite: { siteSlug: 'acme-docs' } },
    })
  })

  it('refuses a home document that has never been published', async () => {
    const draft = documentId('00000000-0000-4000-8000-000000000203')
    await uow.repos.documents.create({
      id: draft,
      shortId: aShortId(),
      workspaceId: WORKSPACE,
      collectionId: 'guides',
      parentId: null,
      slug: 'half-written',
      path: 'guides/half-written.md',
      title: 'Half written',
      status: 'draft',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
    expect(await publish({ homeDocumentId: draft })).toEqual({ kind: 'home-not-published' })
  })

  it('refuses a home document that is not in the collection', async () => {
    expect(await publish({ homeDocumentId: ELSEWHERE })).toEqual({
      kind: 'home-not-in-collection',
    })
  })

  it('refuses a home document that does not exist', async () => {
    expect(
      await publish({ homeDocumentId: documentId('00000000-0000-4000-8000-0000000002ff') }),
    ).toEqual({ kind: 'home-not-in-collection' })
  })

  it('refuses an address another collection already answers at', async () => {
    await publishCollection(deps, { collectionId: 'runbooks', publishedBy: ADMIN })
    expect(await publish({ siteSlug: 'runbooks' })).toEqual({
      kind: 'slug-taken',
      siteSlug: 'runbooks',
    })
  })

  /**
   * The address is claimed by the unique index, not by the read before it, so
   * a second publish that slips past the check is still told the same thing —
   * which is what stops a race becoming a server fault (`collections_public_site_slug_key`).
   */
  it('is told the address is taken by the write, not only by the read', async () => {
    await uow.repos.collections.setPublicSite('runbooks', {
      enabled: true,
      siteSlug: 'contested',
      homeDocumentId: null,
    })
    // The read below is made stale on purpose: the row was written directly.
    expect(await publish({ siteSlug: 'contested' })).toEqual({
      kind: 'slug-taken',
      siteSlug: 'contested',
    })
  })

  /**
   * A republish at a new address leaves the old slug's redirects describing a
   * site that no longer exists, and frees that slug for another collection,
   * which would inherit them.
   */
  it('takes the old address’s redirects with it when the address changes', async () => {
    await publish({ siteSlug: 'first-address' })
    await uow.repos.publicRedirects.record({
      id: 'old',
      siteSlug: 'first-address',
      path: 'developer-guides/a-page',
      documentId: HOME,
      now: NOW,
    })

    // Another site's redirect is not this publish's to remove.
    await uow.repos.publicRedirects.record({
      id: 'elsewhere',
      siteSlug: 'someone-else',
      path: 'runbooks/a-page',
      documentId: ELSEWHERE,
      now: NOW,
    })

    await publish({ siteSlug: 'second-address' })
    expect(
      await uow.repos.publicRedirects.find('first-address', 'developer-guides/a-page'),
    ).toBeNull()
    expect(await uow.repos.publicRedirects.find('someone-else', 'runbooks/a-page')).not.toBeNull()
  })

  it('keeps them when the address does not change', async () => {
    await publish({ siteSlug: 'steady' })
    await uow.repos.publicRedirects.record({
      id: 'kept',
      siteSlug: 'steady',
      path: 'developer-guides/a-page',
      documentId: HOME,
      now: NOW,
    })
    await publish()
    expect(await uow.repos.publicRedirects.find('steady', 'developer-guides/a-page')).not.toBeNull()
  })

  it('refuses when the organisation does not allow publishing', async () => {
    settings.place('organisation', allowing(false))
    expect(await publish()).toEqual({ kind: 'not-allowed' })
    expect(await publicGrants()).toEqual([])
  })

  it('refuses when the organisation settings cannot be read', async () => {
    const revision = settings.place('organisation', 'version: 99\n')
    expect(await publish()).toMatchObject({ kind: 'settings-unreadable', revision })
  })

  it('refuses a collection that is not there', async () => {
    expect(await publish({ collectionId: 'nothing' })).toEqual({ kind: 'not-found' })
  })
})

describe('unpublishing a collection', () => {
  it('turns the switch off, keeps the address, and removes the public grant', async () => {
    await publish({ siteSlug: 'acme-docs' })
    const result = await unpublishCollection(deps, {
      collectionId: 'guides',
      unpublishedBy: ADMIN,
    })
    expect(result).toMatchObject({
      kind: 'unpublished',
      collection: { publicSite: { enabled: false, siteSlug: 'acme-docs' } },
    })
    expect(await publicGrants()).toEqual([])
  })

  it('writes an audit row', async () => {
    await publish({ siteSlug: 'acme-docs' })
    await unpublishCollection(deps, { collectionId: 'guides', unpublishedBy: ADMIN })
    expect(uow.auditEvents).toContainEqual(
      expect.objectContaining({ type: PUBLIC_PUBLISHING_AUDIT_EVENTS.unpublished }),
    )
  })

  it('is not refused by a policy that has since been turned off', async () => {
    await publish()
    settings.place('organisation', allowing(false))
    expect(
      await unpublishCollection(deps, { collectionId: 'guides', unpublishedBy: ADMIN }),
    ).toMatchObject({ kind: 'unpublished' })
  })

  it('answers not-published for a collection that never was', async () => {
    expect(
      await unpublishCollection(deps, { collectionId: 'guides', unpublishedBy: ADMIN }),
    ).toEqual({ kind: 'not-published' })
  })

  it('answers not-found for a collection that is not there', async () => {
    expect(
      await unpublishCollection(deps, { collectionId: 'nothing', unpublishedBy: ADMIN }),
    ).toEqual({ kind: 'not-found' })
  })
})
