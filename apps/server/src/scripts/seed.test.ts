import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getWorkspaceTree, readPublished, renderDocument } from '@quill/application'

import { documentId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  seedDevelopmentData,
  WRITER_EMAIL,
  WRITER_PASSWORD,
  withDocumentLinks,
} from './seed.ts'
import { SEED_COLLECTIONS, SEED_DOCUMENTS, SECOND_WORKSPACE_DOCUMENTS } from './seed-documents.ts'

/**
 * The seed is what a new contributor sees first, so it is held to the same bar
 * as the API: everything goes through the use cases, and running it twice
 * changes nothing.
 */

const PUBLISHED_SEED_DOCUMENTS = SEED_DOCUMENTS.filter((seed) => seed.published !== false)
const DRAFT_SEED_DOCUMENTS = SEED_DOCUMENTS.filter((seed) => seed.published === false)

let harness: ServerHarness

beforeAll(async () => {
  harness = await createServerHarness()
}, 30_000)

afterAll(async () => {
  await harness.close()
})

describe('seedDevelopmentData', () => {
  it('creates an administrator, a writer, a workspace, collections, and published documents', async () => {
    const result = await seedDevelopmentData(harness.deps)

    expect(result.adminEmail).toBe(ADMIN_EMAIL)
    expect(result.created).toHaveLength(SEED_DOCUMENTS.length + SECOND_WORKSPACE_DOCUMENTS.length)
    expect(result.unchanged).toEqual([])

    const admin = await harness.deps.uow.repos.users.findByEmail(ADMIN_EMAIL)
    expect(admin?.isInstanceAdmin).toBe(true)
    expect(admin?.emailVerifiedAt).not.toBeNull()
    const credential = await harness.deps.uow.repos.credentials.findByUserId(
      admin?.id ?? ('' as never),
    )
    expect(
      await harness.deps.passwords.verify(credential?.passwordHash ?? '', ADMIN_PASSWORD),
    ).toBe(true)

    const writer = await harness.deps.uow.repos.users.findByEmail(WRITER_EMAIL)
    expect(writer?.isInstanceAdmin).toBe(false)
    expect(writer?.emailVerifiedAt).not.toBeNull()
    const writerCredential = await harness.deps.uow.repos.credentials.findByUserId(
      writer?.id ?? ('' as never),
    )
    expect(
      await harness.deps.passwords.verify(writerCredential?.passwordHash ?? '', WRITER_PASSWORD),
    ).toBe(true)

    const grants = await harness.deps.uow.repos.grants.listForScope('workspace', result.workspaceId)
    expect(grants).toContainEqual(
      expect.objectContaining({
        principalKind: 'user',
        principalId: writer?.id,
        role: 'editor',
        effect: 'allow',
      }),
    )

    const tree = await getWorkspaceTree(harness.deps, {
      workspaceId: result.workspaceId,
      identities: [],
      seesEverything: true,
    })
    expect(tree.kind).toBe('tree')
    if (tree.kind !== 'tree') return
    // Every collection the seed declares, in the order the tree reads them.
    expect(tree.collections.map((collection) => collection.name)).toEqual(
      [...SEED_COLLECTIONS].toSorted(),
    )
    expect(tree.collections.flatMap((collection) => collection.documents)).toHaveLength(
      SEED_DOCUMENTS.length,
    )
  })

  it('creates a second unit and workspace with a published document of its own', async () => {
    const result = await seedDevelopmentData(harness.deps)

    const tree = await getWorkspaceTree(harness.deps, {
      workspaceId: result.secondWorkspaceId,
      identities: [],
      seesEverything: true,
    })
    expect(tree.kind).toBe('tree')
    if (tree.kind !== 'tree') return
    expect(tree.collections.flatMap((collection) => collection.documents)).toHaveLength(
      SECOND_WORKSPACE_DOCUMENTS.length,
    )

    const units = await harness.database.pool.query(
      'SELECT name FROM organisational_units ORDER BY name',
    )
    expect(units.rows.map((row: { name: string }) => row.name)).toEqual(['Acme', 'Platform'])
  })

  it('publishes every non-draft document, with history, a cached render, and resolved links', async () => {
    const documents = await harness.deps.uow.repos.documents.listByWorkspace(
      (await harness.deps.uow.repos.workspaces.findBySlug('engineering'))?.id ?? ('' as never),
    )
    expect(documents).toHaveLength(SEED_DOCUMENTS.length)

    for (const seed of PUBLISHED_SEED_DOCUMENTS) {
      const document = documents.find((candidate) => candidate.title === seed.title)
      expect(document?.status).toBe('published')
      expect(document?.headRevision).not.toBeNull()

      const published = await readPublished(harness.deps, {
        documentId: document?.id ?? ('' as never),
      })
      expect(published.kind).toBe('found')

      const rendered = await renderDocument(harness.deps, {
        documentId: document?.id ?? ('' as never),
      })
      expect(rendered.kind === 'rendered' && rendered.cached).toBe(true)

      const history = await harness.deps.uow.repos.revisions.listForDocument(
        document?.id ?? ('' as never),
        { limit: 5 },
      )
      expect(history[0]?.changeNote).toBe('Seeded for local development')
    }

    const overview = documents.find((document) => document.title === 'System overview')
    const links = await harness.deps.uow.repos.documentLinks.listForDocument(
      overview?.id ?? ('' as never),
    )
    expect(links.filter((link) => link.kind === 'document')).toHaveLength(2)
    expect(links.every((link) => link.targetDocumentId !== null)).toBe(true)
  })

  it('leaves a document marked published: false as an unpublished draft', async () => {
    expect(DRAFT_SEED_DOCUMENTS.map((seed) => seed.title)).toEqual([
      'Incident review template (draft)',
    ])

    const documents = await harness.deps.uow.repos.documents.listByWorkspace(
      (await harness.deps.uow.repos.workspaces.findBySlug('engineering'))?.id ?? ('' as never),
    )
    const draft = documents.find(
      (document) => document.title === 'Incident review template (draft)',
    )
    expect(draft?.status).toBe('draft')
    expect(draft?.headRevision).toBeNull()

    const published = await readPublished(harness.deps, {
      documentId: draft?.id ?? ('' as never),
    })
    expect(published.kind).not.toBe('found')
  })

  it('publishes the three templates in the Templates collection with their questions intact', async () => {
    const workspace = await harness.deps.uow.repos.workspaces.findBySlug('engineering')
    const documents = await harness.deps.uow.repos.documents.listByWorkspace(
      workspace?.id ?? ('' as never),
    )
    const templates = documents.filter((document) =>
      ['Architecture decision record', 'Technical design', 'Runbook'].includes(document.title),
    )
    expect(templates).toHaveLength(3)

    for (const template of templates) {
      expect(template.status).toBe('published')
      const published = await readPublished(harness.deps, { documentId: template.id })
      expect(published.kind).toBe('found')
      if (published.kind !== 'found') continue
      const declaration = published.frontMatter['template'] as
        | { name?: unknown; version?: unknown }
        | undefined
      expect(typeof declaration?.name).toBe('string')
      expect(declaration?.version).toBe(1)
    }
  })

  it('changes nothing when it runs again', async () => {
    const before = await harness.database.pool.query(
      'SELECT count(*)::int AS documents, (SELECT count(*)::int FROM revisions_index) AS revisions FROM documents',
    )

    const result = await seedDevelopmentData(harness.deps)
    expect(result.created).toEqual([])
    expect(result.unchanged).toHaveLength(SEED_DOCUMENTS.length + SECOND_WORKSPACE_DOCUMENTS.length)

    const after = await harness.database.pool.query(
      'SELECT count(*)::int AS documents, (SELECT count(*)::int FROM revisions_index) AS revisions FROM documents',
    )
    expect(after.rows[0]).toEqual(before.rows[0])
  })
})

describe('withDocumentLinks', () => {
  const overview = SEED_DOCUMENTS.find((seed) => seed.title === 'System overview')?.markdown ?? ''
  const target = documentId('00000000-0000-4000-8000-000000000201')

  it('links the titles it can resolve and leaves out the ones it cannot', () => {
    const resolved = withDocumentLinks(overview, new Map([['Authentication architecture', target]]))
    expect(resolved).toContain('## Related')
    expect(resolved).toContain(`- [Authentication architecture](/d/${target})`)
    expect(resolved).not.toContain('Regional failover](')
  })

  it('adds nothing when a document links to nothing, or to nothing that exists', () => {
    expect(withDocumentLinks(overview, new Map())).toBe(overview)
    const adr =
      SEED_DOCUMENTS.find((seed) => seed.title.startsWith('Documents are'))?.markdown ?? ''
    expect(withDocumentLinks(adr, new Map([['Anything', target]]))).toBe(adr)
  })
})

describe('seeding beside data that is already there', () => {
  it('reuses the units it created the first time', async () => {
    await harness.database.pool.query('DELETE FROM workspaces')
    const result = await seedDevelopmentData(harness.deps)

    expect(result.created).toHaveLength(SEED_DOCUMENTS.length + SECOND_WORKSPACE_DOCUMENTS.length)
    const units = await harness.database.pool.query(
      'SELECT count(*)::int AS count FROM organisational_units',
    )
    expect(units.rows[0]?.count).toBe(2)
  })
})
