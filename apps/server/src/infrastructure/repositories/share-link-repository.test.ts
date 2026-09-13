import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { documentId, shareLinkId, userId } from '@quill/domain'
import type { ShareLinkId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createShareLinkRepository } from './share-link-repository.ts'

/**
 * The share-link repository against the real table, because the two things
 * worth proving about it are SQL: the unique index on `token_hash` is what a
 * presented token is looked up by, and revocation is the instant a link was
 * *first* closed, which is a conditional update rather than a read and a
 * write.
 */

const DOC = documentId('00000000-0000-4000-8000-000000000001')
const OTHER_DOC = documentId('00000000-0000-4000-8000-000000000002')
const AUTHOR = userId('00000000-0000-4000-8000-0000000000a1')

const LINK = shareLinkId('00000000-0000-4000-8000-000000000101')
const SUBTREE_LINK = shareLinkId('00000000-0000-4000-8000-000000000102')
const MISSING = shareLinkId('00000000-0000-4000-8000-0000000001ff')

const NOW = new Date('2026-01-01T00:00:00.000Z')
const LATER = new Date('2026-01-01T01:00:00.000Z')

let database: TestDatabase
let shareLinks: ReturnType<typeof createShareLinkRepository>

beforeAll(async () => {
  database = await createTestDatabase()
  shareLinks = createShareLinkRepository(database.db)

  await database.pool.query(
    "INSERT INTO organisational_units (id, parent_id, name, created_at) VALUES ('unit-1', NULL, 'Unit', now())",
  )
  await database.pool.query(
    "INSERT INTO workspaces (id, unit_id, name, slug, created_at) VALUES ('workspace-1', 'unit-1', 'Workspace', 'workspace', now())",
  )
  await database.pool.query(
    'INSERT INTO users (id, email, display_name, created_at) VALUES ($1, $2, $2, now())',
    [AUTHOR, 'author@example.com'],
  )
  for (const [index, id] of [DOC, OTHER_DOC].entries()) {
    await database.pool.query(
      `INSERT INTO documents (id, short_id, workspace_id, collection_id, parent_id, slug, path, title, status, template_id, template_version, created_at, updated_at)
       VALUES ($1, $2, 'workspace-1', NULL, NULL, $3, $4, $3, 'draft', NULL, NULL, now(), now())`,
      [id, `000000000${index}`, `doc-${index}`, `/doc-${index}`],
    )
  }
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM share_links')
})

async function seed(
  id: ShareLinkId = LINK,
  overrides: {
    readonly documentId?: typeof DOC
    readonly tokenHash?: string
    readonly scope?: 'document' | 'subtree'
    readonly expiresAt?: Date | null
    readonly now?: Date
  } = {},
): Promise<void> {
  await shareLinks.create({
    id,
    documentId: overrides.documentId ?? DOC,
    tokenHash: overrides.tokenHash ?? `hash-${id}`,
    scope: overrides.scope ?? 'document',
    role: 'viewer',
    expiresAt: overrides.expiresAt ?? null,
    createdBy: AUTHOR,
    now: overrides.now ?? NOW,
  })
}

describe('createShareLinkRepository', () => {
  it('writes a link and reads it back by id and by the hash a token presents', async () => {
    await seed(LINK, { tokenHash: 'hash-one', expiresAt: LATER })

    const byId = await shareLinks.findById(LINK)
    expect(byId).toEqual({
      id: LINK,
      documentId: DOC,
      tokenHash: 'hash-one',
      scope: 'document',
      role: 'viewer',
      expiresAt: LATER,
      createdBy: AUTHOR,
      revokedAt: null,
      createdAt: NOW,
      lastUsedAt: null,
    })
    expect(await shareLinks.findByTokenHash('hash-one')).toEqual(byId)
  })

  it('reports a miss rather than guessing', async () => {
    expect(await shareLinks.findById(MISSING)).toBeNull()
    expect(await shareLinks.findByTokenHash('nothing-hashes-to-this')).toBeNull()
  })

  it('refuses two links with the same token hash', async () => {
    await seed(LINK, { tokenHash: 'collide' })
    await expect(seed(SUBTREE_LINK, { tokenHash: 'collide' })).rejects.toThrow(/share_links/)
  })

  it('lists one document’s links newest first, and none of another’s', async () => {
    await seed(LINK, { now: NOW })
    await seed(SUBTREE_LINK, { scope: 'subtree', now: LATER })

    expect((await shareLinks.listForDocument(DOC)).map((row) => row.id)).toEqual([
      SUBTREE_LINK,
      LINK,
    ])
    expect(await shareLinks.listForDocument(OTHER_DOC)).toEqual([])
  })

  it('keeps the instant a link was first revoked, however often it is revoked again', async () => {
    await seed()
    expect((await shareLinks.revoke(LINK, NOW))?.revokedAt).toEqual(NOW)
    // The conditional update matches nothing the second time, so the row is
    // read back as it stands rather than being moved forward.
    expect((await shareLinks.revoke(LINK, LATER))?.revokedAt).toEqual(NOW)
  })

  it('reports revoking a link that is not there', async () => {
    expect(await shareLinks.revoke(MISSING, NOW)).toBeNull()
  })

  it('stamps a use, and marking a link that is not there changes nothing', async () => {
    await seed()
    await shareLinks.markUsed(LINK, LATER)
    expect((await shareLinks.findById(LINK))?.lastUsedAt).toEqual(LATER)
    await expect(shareLinks.markUsed(MISSING, LATER)).resolves.toBeUndefined()
  })

  it('goes with the document it opens', async () => {
    await seed()
    await database.pool.query('DELETE FROM documents WHERE id = $1', [DOC])
    expect(await shareLinks.findById(LINK)).toBeNull()

    // Put it back for the tests that follow.
    await database.pool.query(
      `INSERT INTO documents (id, short_id, workspace_id, collection_id, parent_id, slug, path, title, status, template_id, template_version, created_at, updated_at)
       VALUES ($1, '0000000000', 'workspace-1', NULL, NULL, 'doc-0', '/doc-0', 'doc-0', 'draft', NULL, NULL, now(), now())`,
      [DOC],
    )
  })
})
