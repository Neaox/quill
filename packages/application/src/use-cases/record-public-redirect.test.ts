import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { aShortId, createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { recordMoveRedirect, recordRenameRedirect } from './record-public-redirect.ts'
import type { PublicRedirectDependencies } from './record-public-redirect.ts'

/**
 * The price ADR-035 pays for readable public addresses: when a page moves, the
 * address it had keeps working.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const PAGE = documentId('00000000-0000-4000-8000-000000000201')
const SIBLING = documentId('00000000-0000-4000-8000-000000000202')

let uow: InMemoryUnitOfWork
let deps: PublicRedirectDependencies

async function collection(id: string, name: string, site: string | null): Promise<void> {
  await uow.repos.collections.create({
    id,
    workspaceId: WORKSPACE,
    name,
    slug: id,
    now: NOW,
  })
  if (site !== null) {
    await uow.repos.collections.setPublicSite(id, {
      enabled: true,
      siteSlug: site,
      homeDocumentId: null,
    })
  }
}

async function document(id: DocumentId, title: string, inCollection: string): Promise<void> {
  await uow.repos.documents.create({
    id,
    shortId: aShortId(),
    workspaceId: WORKSPACE,
    collectionId: inCollection,
    parentId: null,
    slug: 'a-page',
    path: `${inCollection}/a-page.md`,
    title,
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  deps = { uow, clock: createFakeClock(NOW), ids: createFakeIdGenerator() }
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await collection('guides', 'Guides', 'acme-docs')
  await collection('internal', 'Internal', null)
  await collection('runbooks', 'Runbooks', 'ops')
  await document(PAGE, 'Rate limits', 'guides')
})

describe('after a rename', () => {
  it('records the address the page used to answer at', async () => {
    await uow.repos.documents.update(PAGE, { title: 'Throttling' }, NOW)
    await recordRenameRedirect(deps, { documentId: PAGE, previousTitle: 'Rate limits' })
    expect(await uow.repos.publicRedirects.find('acme-docs', 'guides/rate-limits')).toMatchObject({
      documentId: PAGE,
    })
  })

  it('leaves its siblings where they are', async () => {
    await document(SIBLING, 'Quotas', 'guides')
    await uow.repos.documents.update(PAGE, { title: 'Throttling' }, NOW)
    await recordRenameRedirect(deps, { documentId: PAGE, previousTitle: 'Rate limits' })
    expect(await uow.repos.publicRedirects.find('acme-docs', 'guides/quotas')).toBeNull()
  })

  it('clears a redirect standing at the address the page has just taken', async () => {
    await uow.repos.publicRedirects.record({
      id: 'stale',
      siteSlug: 'acme-docs',
      path: 'guides/throttling',
      documentId: SIBLING,
      now: NOW,
    })
    await uow.repos.documents.update(PAGE, { title: 'Throttling' }, NOW)
    await recordRenameRedirect(deps, { documentId: PAGE, previousTitle: 'Rate limits' })
    expect(await uow.repos.publicRedirects.find('acme-docs', 'guides/throttling')).toBeNull()
  })

  it('writes nothing when the address did not change', async () => {
    await uow.repos.documents.update(PAGE, { title: 'Rate  limits' }, NOW)
    await recordRenameRedirect(deps, { documentId: PAGE, previousTitle: 'Rate limits' })
    expect(await uow.repos.publicRedirects.find('acme-docs', 'guides/rate-limits')).toBeNull()
  })

  it('writes nothing in a collection that has never been published', async () => {
    await document(SIBLING, 'Payroll', 'internal')
    await uow.repos.documents.update(SIBLING, { title: 'Wages' }, NOW)
    await recordRenameRedirect(deps, { documentId: SIBLING, previousTitle: 'Payroll' })
    expect(await uow.repos.publicRedirects.find('internal', 'internal/payroll')).toBeNull()
  })

  it('still records while the site is switched off, so it works when it comes back', async () => {
    await uow.repos.collections.setPublicSite('guides', {
      enabled: false,
      siteSlug: 'acme-docs',
      homeDocumentId: null,
    })
    await uow.repos.documents.update(PAGE, { title: 'Throttling' }, NOW)
    await recordRenameRedirect(deps, { documentId: PAGE, previousTitle: 'Rate limits' })
    expect(await uow.repos.publicRedirects.find('acme-docs', 'guides/rate-limits')).not.toBeNull()
  })

  it('writes nothing for a document that has gone', async () => {
    await recordRenameRedirect(deps, {
      documentId: documentId('00000000-0000-4000-8000-0000000002ff'),
      previousTitle: 'Anything',
    })
    expect(uow.events).toEqual([])
  })

  it('writes nothing for a document filed in no collection', async () => {
    await uow.repos.documents.update(PAGE, { collectionId: null }, NOW)
    await recordRenameRedirect(deps, { documentId: PAGE, previousTitle: 'Rate limits' })
    expect(await uow.repos.publicRedirects.find('acme-docs', 'guides/rate-limits')).toBeNull()
  })
})

describe('after a move between collections', () => {
  it('records the address on the site it left', async () => {
    await uow.repos.documents.update(PAGE, { collectionId: 'runbooks' }, NOW)
    await recordMoveRedirect(deps, { documentId: PAGE, fromCollectionId: 'guides' })
    expect(await uow.repos.publicRedirects.find('acme-docs', 'guides/rate-limits')).toMatchObject({
      documentId: PAGE,
    })
  })

  it('clears a redirect standing at its new address', async () => {
    await uow.repos.publicRedirects.record({
      id: 'stale',
      siteSlug: 'ops',
      path: 'runbooks/rate-limits',
      documentId: SIBLING,
      now: NOW,
    })
    await uow.repos.documents.update(PAGE, { collectionId: 'runbooks' }, NOW)
    await recordMoveRedirect(deps, { documentId: PAGE, fromCollectionId: 'guides' })
    expect(await uow.repos.publicRedirects.find('ops', 'runbooks/rate-limits')).toBeNull()
  })

  it('writes nothing when the collection it left was never published', async () => {
    await document(SIBLING, 'Payroll', 'internal')
    await uow.repos.documents.update(SIBLING, { collectionId: 'guides' }, NOW)
    await recordMoveRedirect(deps, { documentId: SIBLING, fromCollectionId: 'internal' })
    expect(await uow.repos.publicRedirects.find('acme-docs', 'internal/payroll')).toBeNull()
  })

  it('writes nothing when the document came from no collection at all', async () => {
    await recordMoveRedirect(deps, { documentId: PAGE, fromCollectionId: null })
    expect(await uow.repos.publicRedirects.find('acme-docs', 'guides/rate-limits')).toBeNull()
  })

  it('records the old address even when it moved into a collection nobody publishes', async () => {
    await uow.repos.documents.update(PAGE, { collectionId: 'internal' }, NOW)
    await recordMoveRedirect(deps, { documentId: PAGE, fromCollectionId: 'guides' })
    expect(await uow.repos.publicRedirects.find('acme-docs', 'guides/rate-limits')).toMatchObject({
      documentId: PAGE,
    })
  })

  it('writes nothing for a document that has gone', async () => {
    await recordMoveRedirect(deps, {
      documentId: documentId('00000000-0000-4000-8000-0000000002ff'),
      fromCollectionId: 'guides',
    })
    expect(await uow.repos.publicRedirects.find('acme-docs', 'guides/rate-limits')).toBeNull()
  })
})
