import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDocument } from '@quill/markdown'
import { revisionId } from '@quill/domain'
import type { DocumentId, WorkspaceId } from '@quill/domain'

import { createServerHarness, HARNESS_NOW } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The M2 content journey end to end, over a real database, the real content
 * store, and the real Markdown pipeline: create, draft, publish, read the
 * rendered body, walk the history, restore, and compare — plus what happens
 * when two editors publish from the same base, and what a reader who was
 * never granted anything sees.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>

const UNKNOWN_DOCUMENT = '00000000-0000-4000-8000-0000000000ff'

const MARKDOWN = [
  '# Authentication architecture',
  '',
  'Tokens are signed with a rotating key.',
  '',
  '```ts',
  'const token = sign(claims)',
  '```',
  '',
  '## Rotation',
  '',
  '| Key | Rotates |',
  '| --- | --- |',
  '| signing | 90 days |',
].join('\n')

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

async function createDocument(
  title: string,
  body: Record<string, unknown> = {},
  cookies = editor,
): Promise<DocumentId> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies,
    payload: { collectionId: tenancy.collectionId, title, ...body },
  })
  expect(response.statusCode).toBe(201)
  return response.json().document.id as DocumentId
}

/** The draft envelope the editor writes: front matter and the document tree (ADR-021). */
function draftOf(markdown: string): unknown {
  const { frontMatter, ast } = parseDocument(markdown)
  return { version: 1, frontMatter, ast }
}

async function writeDraft(
  id: DocumentId,
  markdown: string,
  expectedVersion: number,
): Promise<void> {
  const acquired = await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/lock/acquire`,
    cookies: editor,
  })
  expect(acquired.statusCode).toBe(200)

  const write = await harness.app.inject({
    method: 'PUT',
    url: `/api/documents/${id}/draft`,
    cookies: editor,
    payload: { ast: draftOf(markdown), expectedVersion } as Record<string, unknown>,
  })
  expect(write.statusCode).toBe(200)

  await harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/lock`, cookies: editor })
}

async function publish(id: DocumentId, base: string | null, cookies = editor, changeNote?: string) {
  return await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/publish`,
    cookies,
    payload: { base, ...(changeNote === undefined ? {} : { changeNote }) },
  })
}

async function get(
  url: string,
  cookies: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return await harness.app.inject({ method: 'GET', url, cookies, headers })
}

describe('the content journey', () => {
  it('creates, drafts, publishes, reads, renders, lists history, restores, and compares', async () => {
    const id = await createDocument('Authentication architecture')
    await writeDraft(id, MARKDOWN, 0)

    const published = await publish(id, null, editor, 'First pass')
    expect(published.statusCode).toBe(200)
    const revision = published.json().revision as string
    expect(revision).toMatch(/^[0-9a-f]{40}$/)
    expect(published.json()).toMatchObject({
      kind: 'published',
      warnings: [],
      frontMatterIssues: [],
      incompleteRequiredSections: [],
    })

    const metadata = await get(`/api/documents/${id}`, viewer)
    expect(metadata.json()).toMatchObject({
      status: 'published',
      headRevision: revision,
      path: 'architecture/authentication-architecture.md',
      title: 'Authentication architecture',
    })

    const content = await get(`/api/documents/${id}/content`, viewer)
    expect(content.statusCode).toBe(200)
    expect(content.json().markdown).toContain('Tokens are signed with a rotating key.')
    expect(content.json().frontMatter.id).toBe(id)

    const rendered = await get(`/api/documents/${id}/rendered`, viewer)
    expect(rendered.statusCode).toBe(200)
    expect(rendered.json().html).toContain('<article>')
    // The server tokenizes; the reader downloads no grammars (ADR-030).
    // `data-lang` names the grammar the packed ranges came from, not the
    // fence tag the author typed: the highlighter resolves `ts` to
    // `typescript` and reports what it actually used (ADR-030).
    expect(rendered.json().html).toContain('data-lang="typescript"')
    expect(rendered.json().html).toContain('data-tokens=')
    expect(rendered.json().html).toContain('<table>')
    expect(rendered.json().outline.map((entry: { text: string }) => entry.text)).toEqual([
      'Authentication architecture',
    ])
    expect(rendered.json().outline[0].children[0].text).toBe('Rotation')
    expect(rendered.json().slots).toEqual([])
    // The tag is the render-cache key: the hash of everything the body was
    // rendered from, and the render version (ADR-031).
    expect(rendered.headers.etag).toMatch(/^"[0-9a-f]{64}:\d+"$/)

    const history = await get(`/api/documents/${id}/history?limit=10`, viewer)
    expect(history.statusCode).toBe(200)
    expect(history.json().revisions).toHaveLength(1)
    expect(history.json().revisions[0]).toMatchObject({
      revision,
      summary: 'Authentication architecture',
      changeNote: 'First pass',
      author: { name: 'Editor', email: 'editor@example.com' },
    })
    expect(history.json().nextCursor).toBeUndefined()

    const second = `${MARKDOWN}\n\nA second pass.\n`
    await writeDraft(id, second, 1)
    const republished = await publish(id, revision)
    expect(republished.statusCode).toBe(200)
    const secondRevision = republished.json().revision as string

    const diff = await get(
      `/api/documents/${id}/diff?from=${revision}&to=${secondRevision}`,
      viewer,
    )
    expect(diff.statusCode).toBe(200)
    expect(diff.json().unified).toContain('+A second pass.')
    expect(diff.json()).toMatchObject({ from: revision, to: secondRevision })
    expect(diff.json().added).toBeGreaterThan(0)

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/restore`,
      cookies: editor,
      payload: { revision, changeNote: 'Undo the second pass' },
    })
    expect(restored.statusCode).toBe(200)
    expect(restored.json().revision).not.toBe(revision)

    const afterRestore = await get(`/api/documents/${id}/content`, viewer)
    expect(afterRestore.json().markdown).not.toContain('A second pass.')

    const finalHistory = await get(`/api/documents/${id}/history?limit=2`, viewer)
    expect(finalHistory.json().revisions).toHaveLength(2)
    expect(finalHistory.json().nextCursor).toBeDefined()
    const nextPage = await get(
      `/api/documents/${id}/history?limit=2&cursor=${finalHistory.json().nextCursor}`,
      viewer,
    )
    expect(nextPage.json().revisions).toHaveLength(1)
  })

  it('restores onto the draft, so the author does not undo the restore next publish', async () => {
    const id = await createDocument('Restored onto the draft')
    await writeDraft(id, '# Restored onto the draft\n\nThe original.\n', 0)
    const first = await publish(id, null)
    expect(first.statusCode).toBe(200)
    const original = first.json().revision as string

    await writeDraft(id, '# Restored onto the draft\n\nA regrettable edit.\n', 1)
    expect((await publish(id, original)).statusCode).toBe(200)

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/restore`,
      cookies: editor,
      payload: { revision: original },
    })
    expect(restored.statusCode).toBe(200)

    // The draft now holds what was restored and is based on the revision the
    // restore created, so publishing it again republishes the restored
    // content rather than the edit that was undone (ADR-015).
    const draft = await get(`/api/documents/${id}/draft`, editor)
    expect(JSON.stringify(draft.json().ast)).toContain('The original.')
    expect(draft.json().baseRevision).toBe(restored.json().revision)

    const republished = await publish(id, restored.json().revision as string)
    expect(republished.statusCode).toBe(200)
    expect((await get(`/api/documents/${id}/content`, viewer)).json().markdown).toContain(
      'The original.',
    )
  })

  it('refuses to restore over a lock somebody else holds, and merges an external edit', async () => {
    const id = await createDocument('Restore under contention')
    await writeDraft(id, '# Restore under contention\n\nThe original.\n', 0)
    const first = await publish(id, null)
    const original = first.json().revision as string
    await writeDraft(id, '# Restore under contention\n\nA regrettable edit.\n', 1)
    expect((await publish(id, original)).statusCode).toBe(200)

    const restore = async (cookies: Record<string, string>) =>
      await harness.app.inject({
        method: 'POST',
        url: `/api/documents/${id}/restore`,
        cookies,
        payload: { revision: original },
      })

    const takeover = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/lock/acquire`,
      cookies: admin,
    })
    expect(takeover.statusCode).toBe(200)
    const refused = await restore(editor)
    expect(refused.statusCode).toBe(423)
    expect(refused.json().error).toMatchObject({ code: 'lock_lost' })

    await harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/lock`, cookies: admin })

    // An edit arriving outside this API — Git sync — moves the content store
    // on without moving the document's recorded head, which is the base a
    // restore publishes against (ADR-015).
    const document = await harness.deps.uow.repos.documents.findById(id)
    await harness.deps.contentStore.publish({
      workspaceId: tenancy.workspaceId,
      changes: [
        {
          kind: 'write',
          documentId: id,
          path: document?.path ?? '',
          markdown: '# Restore under contention\n\nSomebody else was here.\n',
        },
      ],
      author: { name: 'Grace', email: 'grace@example.com' },
      base: document?.headRevision ?? null,
    })

    const conflicted = await restore(editor)
    expect(conflicted.statusCode).toBe(409)
    expect(conflicted.json()).toMatchObject({ kind: 'merge-required' })
  })

  it('serves 304 when the reader already holds the rendered body', async () => {
    const id = await createDocument('Cacheable')
    await writeDraft(id, '# Cacheable\n\nA body.\n', 0)
    const published = await publish(id, null)
    expect(published.statusCode).toBe(200)

    const first = await get(`/api/documents/${id}/rendered`, viewer)
    const etag = first.headers.etag as string
    expect(etag).toBeDefined()

    const second = await get(`/api/documents/${id}/rendered`, viewer, { 'if-none-match': etag })
    expect(second.statusCode).toBe(304)
    expect(second.body).toBe('')
  })

  it('refuses a base the draft does not record, rather than merging against it', async () => {
    const id = await createDocument('Contended document')
    await writeDraft(id, '# Contended document\n\nThe first version.\n', 0)
    const first = await publish(id, null)
    const base = first.json().revision as string

    await writeDraft(id, '# Contended document\n\nTheirs.\n', 1)
    expect((await publish(id, base)).statusCode).toBe(200)

    // A client still holding the first revision as its base has not re-read
    // the draft since; it is told so rather than three-way merged against a
    // base its author never edited from (ADR-015).
    await writeDraft(id, '# Contended document\n\nOurs, from a stale editor.\n', 2)
    const stale = await publish(id, base)
    expect(stale.statusCode).toBe(422)
    expect(stale.json().error).toMatchObject({ code: 'stale_base' })

    const history = await get(`/api/documents/${id}/history?limit=10`, viewer)
    expect(history.json().revisions).toHaveLength(2)
  })

  it('reports merge-required when the content store moved under the draft', async () => {
    const id = await createDocument('Externally edited')
    await writeDraft(id, '# Externally edited\n\nThe first version.\n', 0)
    const first = await publish(id, null)
    expect(first.statusCode).toBe(200)

    // An edit arriving through Git sync rather than through this API: the
    // content store moves on, and the draft's base is now behind it. The same
    // rule governs both (ADR-015).
    const document = await harness.deps.uow.repos.documents.findById(id)
    await harness.deps.contentStore.publish({
      workspaceId: tenancy.workspaceId,
      changes: [
        {
          kind: 'write',
          documentId: id,
          path: document?.path ?? '',
          markdown: '# Externally edited\n\nSomebody else was here.\n',
        },
      ],
      author: { name: 'Grace', email: 'grace@example.com' },
      base: revisionId(first.json().revision as string),
    })

    await writeDraft(id, '# Externally edited\n\nOurs.\n', 1)
    const conflicted = await publish(id, await baseOf(id))
    expect(conflicted.statusCode).toBe(409)
    expect(conflicted.json()).toMatchObject({ kind: 'merge-required' })
    expect(conflicted.json().conflicts[0]).toMatchObject({ documentId: id })
    expect(conflicted.json().conflicts[0].conflicted).toContain('<<<<<<<')

    // The refused publish created no revision.
    const history = await get(`/api/documents/${id}/history?limit=10`, viewer)
    expect(history.json().revisions).toHaveLength(1)
  })

  it('refuses to publish over a lock somebody else holds', async () => {
    const id = await createDocument('Taken over mid-edit')
    await writeDraft(id, '# Taken over mid-edit\n\nMine.\n', 0)

    // The editor's session is not the one holding the lock: an admin took the
    // document over, so this publish is the previous holder's write (ADR-021).
    const takeover = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/lock/acquire`,
      cookies: admin,
    })
    expect(takeover.statusCode).toBe(200)

    const refused = await publish(id, null)
    expect(refused.statusCode).toBe(423)
    expect(refused.json().error).toMatchObject({ code: 'lock_lost' })
    expect((await get(`/api/documents/${id}/history?limit=10`, viewer)).json().revisions).toEqual(
      [],
    )

    await harness.app.inject({
      method: 'DELETE',
      url: `/api/documents/${id}/lock`,
      cookies: admin,
    })
    expect((await publish(id, null)).statusCode).toBe(200)
  })

  it('renders on publish, so the first reader never pays for a render', async () => {
    const id = await createDocument('Rendered ahead of the reader')
    await writeDraft(id, '# Rendered ahead of the reader\n\nCached on publish.\n', 0)
    const published = await publish(id, null)
    expect(published.statusCode).toBe(200)

    const beforeDrain = await harness.database.pool.query(
      'SELECT count(*)::int AS count FROM render_cache WHERE document_id = $1',
      [id],
    )
    expect(beforeDrain.rows[0]?.count).toBe(0)

    await harness.drainOutbox()

    const afterDrain = await harness.database.pool.query(
      'SELECT content FROM render_cache WHERE document_id = $1',
      [id],
    )
    expect(afterDrain.rows).toHaveLength(1)
    expect(afterDrain.rows[0]?.content.html).toContain('Cached on publish.')
  })

  it('gives a body that links to a renamed document a new cache key', async () => {
    const target = await createDocument('Runbook')
    await writeDraft(target, '# Runbook\n\nWhat to do at 3am.\n', 0)
    expect((await publish(target, null)).statusCode).toBe(200)

    const source = await createDocument('Overview')
    await writeDraft(
      source,
      `# Overview\n\nSee [the runbook](/d/${target}) and [nothing](/d/${UNKNOWN_DOCUMENT}).\n`,
      0,
    )
    expect((await publish(source, await baseOf(source))).statusCode).toBe(200)
    await harness.drainOutbox()

    const links = await harness.deps.uow.repos.documentLinks.listForDocument(source)
    expect(links.map((link) => [link.kind, link.targetDocumentId])).toEqual([
      ['document', target],
      ['document', null],
    ])

    // Nothing was marked or swept: the body is cached under a key covering the
    // titles it links to, so the rename simply gives the next read a new key
    // and the old entry stops being read (ADR-031).
    const before = await get(`/api/documents/${source}/rendered`, viewer)
    await writeDraft(target, '# Incident runbook\n\nWhat to do at 3am.\n', 1)
    expect((await publish(target, await baseOf(target))).statusCode).toBe(200)
    await harness.drainOutbox()

    const after = await get(`/api/documents/${source}/rendered`, viewer)
    expect(after.headers.etag).not.toBe(before.headers.etag)
    const entries = await harness.database.pool.query(
      'SELECT key FROM render_cache WHERE document_id = $1',
      [source],
    )
    expect(entries.rows).toHaveLength(2)
  })

  it('states what is still a placeholder and publishes anyway', async () => {
    const id = await createDocument('Still a draft in places')
    await writeDraft(
      id,
      ['# Still a draft in places', '', ':::placeholder', 'What did we decide?', ':::', ''].join(
        '\n',
      ),
      0,
    )

    const published = await publish(id, await baseOf(id))
    expect(published.statusCode).toBe(200)
    expect(published.json().warnings).toEqual([
      { code: 'placeholder-remains', detail: 'What did we decide?' },
    ])

    const content = await get(`/api/documents/${id}/content`, viewer)
    expect(content.json().markdown).not.toContain('placeholder')
  })

  it('404s a diff against a revision this document never had', async () => {
    const id = await createDocument('Only one revision')
    await writeDraft(id, '# Only one revision\n\nBody.\n', 0)
    const published = await publish(id, await baseOf(id))

    const response = await get(
      `/api/documents/${id}/diff?from=${'f'.repeat(40)}&to=${published.json().revision}`,
      viewer,
    )
    expect(response.statusCode).toBe(404)
  })

  it('404s a restore of a revision this document never had', async () => {
    const id = await createDocument('Never had that revision')
    await writeDraft(id, '# Never had that revision\n\nBody.\n', 0)
    expect((await publish(id, await baseOf(id))).statusCode).toBe(200)

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/restore`,
      cookies: editor,
      payload: { revision: 'f'.repeat(40) },
    })
    expect(response.statusCode).toBe(404)
  })

  it('compares a first revision against nothing', async () => {
    const id = await createDocument('First revision only')
    await writeDraft(id, '# First revision only\n\nBody.\n', 0)
    const published = await publish(id, await baseOf(id))
    const diff = await get(`/api/documents/${id}/diff?to=${published.json().revision}`, viewer)
    expect(diff.statusCode).toBe(200)
    expect(diff.json()).toMatchObject({ from: null, removed: 0 })
  })

  it('reports the live envelope, including health signals', async () => {
    const id = await createDocument('Envelope')
    await writeDraft(
      id,
      `---\nid: ${id}\ntitle: Envelope\nreview:\n  interval: 30d\n---\n\n# Envelope\n\nA body with [a broken link](/d/${UNKNOWN_DOCUMENT}).\n`,
      0,
    )
    expect((await publish(id, await baseOf(id))).statusCode).toBe(200)
    await harness.drainOutbox()
    harness.clock.advance(90 * 24 * 60 * 60 * 1000)

    await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/lock/acquire`,
      cookies: editor,
    })
    const envelope = await get(`/api/documents/${id}/envelope`, viewer)
    await harness.app.inject({
      method: 'DELETE',
      url: `/api/documents/${id}/lock`,
      cookies: editor,
    })
    harness.clock.set(HARNESS_NOW)
    expect(envelope.statusCode).toBe(200)
    expect(envelope.json().permissions).toEqual({
      view: true,
      comment: false,
      edit: false,
      manage: false,
    })
    expect(envelope.json().lastPublished).toMatchObject({ author: 'Editor' })
    expect(envelope.json().review.overdue).toBe(true)
    expect(envelope.json().health.map((signal: { kind: string }) => signal.kind)).toEqual([
      'no-owner',
      'review-overdue',
      'broken-link',
    ])
    expect(envelope.json().lock).toMatchObject({ holderName: 'Editor' })
  })
})

describe('permissions on the content routes', () => {
  it('shows nothing to a reader with no grant, and refuses a viewer the right to publish', async () => {
    const id = await createDocument('Private enough')
    await writeDraft(id, '# Private enough\n\nBody.\n', 0)
    expect((await publish(id, await baseOf(id))).statusCode).toBe(200)

    expect((await get(`/api/documents/${id}`, outsider)).statusCode).toBe(403)
    expect((await get(`/api/documents/${id}/content`, outsider)).statusCode).toBe(403)
    expect((await get(`/api/documents/${id}/rendered`, outsider)).statusCode).toBe(403)
    expect((await get(`/api/documents/${id}/envelope`, outsider)).statusCode).toBe(403)
    expect((await get(`/api/documents/${id}/history?limit=5`, outsider)).statusCode).toBe(403)

    const refused = await publish(id, null, viewer)
    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe('forbidden')
  })

  it('lets an instance admin do what no grant gives them', async () => {
    const id = await createDocument('Administered')
    expect((await get(`/api/documents/${id}`, admin)).statusCode).toBe(200)

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${id}`,
      cookies: admin,
      payload: {
        title: 'Administered and renamed',
        slug: 'administered',
        path: 'architecture/administered.md',
        status: 'archived',
        collectionId: tenancy.collectionId,
      },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toMatchObject({
      title: 'Administered and renamed',
      // The slug a client puts in a URL follows the current title (ADR-035);
      // the stored path segment is what the patch set, and is in `path`.
      slug: 'administered-and-renamed',
      path: 'architecture/administered.md',
      status: 'archived',
    })

    const nested = await createDocument('Nested under the administered one')
    const reparented = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${nested}`,
      cookies: admin,
      payload: { parentId: id },
    })
    expect(reparented.json().parentId).toBe(id)

    expect(
      (
        await harness.app.inject({
          method: 'PATCH',
          url: `/api/documents/${id}`,
          cookies: editor,
          payload: { title: 'Not allowed' },
        })
      ).statusCode,
    ).toBe(403)

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/documents/${id}`,
      cookies: admin,
    })
    expect(deleted.statusCode).toBe(204)
    expect((await get(`/api/documents/${id}`, admin)).statusCode).toBe(404)
  })

  /**
   * Use case 8, reproduced through the API alone and then fixed: the rename
   * set the row's title, the publish re-derived the title from the draft's
   * front matter — which the rename had not touched — and the new name was
   * silently undone. A rename now writes the document, which is where the
   * title lives; the row is an index of it (ADR-034).
   */
  it('keeps a rename through the publish that follows it', async () => {
    const id = await createDocument('Probe')
    await writeDraft(id, ['# Probe', '', 'Something to publish.'].join('\n'), 0)

    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${id}`,
      cookies: admin,
      payload: { title: 'Renamed probe' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().title).toBe('Renamed probe')
    expect((await get(`/api/documents/${id}`, editor)).json().title).toBe('Renamed probe')

    expect((await publish(id, null)).statusCode).toBe(200)
    expect((await get(`/api/documents/${id}`, editor)).json().title).toBe('Renamed probe')

    // And the published document says so itself, in both the places a title
    // can live, so the next publish has nothing to undo.
    const content = (await get(`/api/documents/${id}/content`, editor)).json()
    expect(content.frontMatter.title).toBe('Renamed probe')
    expect(content.markdown).toContain('# Renamed probe')
  })

  it('refuses a rename while another session holds the document', async () => {
    const id = await createDocument('Held while renamed')
    const acquired = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/lock/acquire`,
      cookies: editor,
    })
    expect(acquired.statusCode).toBe(200)

    const refused = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${id}`,
      cookies: admin,
      payload: { title: 'Renamed over their work' },
    })
    expect(refused.statusCode).toBe(423)
    expect(refused.json().error.code).toBe('lock_lost')
    expect((await get(`/api/documents/${id}`, editor)).json().title).toBe('Held while renamed')

    await harness.app.inject({
      method: 'DELETE',
      url: `/api/documents/${id}/lock`,
      cookies: editor,
    })
    const allowed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${id}`,
      cookies: admin,
      payload: { title: 'Renamed once they left' },
    })
    expect(allowed.statusCode).toBe(200)
  })

  it('404s an unknown document and a document that has never been published', async () => {
    expect((await get(`/api/documents/${UNKNOWN_DOCUMENT}`, admin)).statusCode).toBe(404)

    const id = await createDocument('Never published')
    expect((await get(`/api/documents/${id}/content`, viewer)).statusCode).toBe(404)
    expect((await get(`/api/documents/${id}/rendered`, viewer)).statusCode).toBe(404)

    const envelope = await get(`/api/documents/${id}/envelope`, viewer)
    expect(envelope.json()).toMatchObject({ lastPublished: null, review: null, health: [] })
  })

  it('refuses to publish a document with no draft and reports an unreadable one', async () => {
    const id = await createDocument('Draftless')
    await harness.database.pool.query('DELETE FROM drafts WHERE document_id = $1', [id])
    expect((await publish(id, null)).statusCode).toBe(404)

    const unreadable = await createDocument('From the future')
    await harness.database.pool.query('UPDATE drafts SET ast = $2 WHERE document_id = $1', [
      unreadable,
      JSON.stringify({ version: 99 }),
    ])
    const response = await publish(unreadable, null)
    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('draft_unreadable')
  })
})

/**
 * The base a client publishes with: the revision the draft itself records,
 * which is null until the document's first publish (ADR-015). A caller that
 * sends anything else is told to re-read rather than merged against a base
 * its author never edited from.
 */
async function baseOf(id: DocumentId): Promise<string | null> {
  return (await harness.deps.uow.repos.drafts.find(id))?.baseRevision ?? null
}

/**
 * Review finding H5. The patch used to reach the repository unchecked, and
 * `parent_id` had no foreign key, so one request could make a document
 * permanently unresolvable — including to the PATCH that would undo it.
 */
describe('moving a document', () => {
  it('moves it under a parent in the same collection', async () => {
    const parent = await createDocument('A parent')
    const child = await createDocument('A child')

    const moved = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${child}`,
      cookies: admin,
      payload: { parentId: parent },
    })
    expect(moved.statusCode).toBe(200)
    expect(moved.json().parentId).toBe(parent)

    // And back to the root of its collection.
    const lifted = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${child}`,
      cookies: admin,
      payload: { parentId: null },
    })
    expect(lifted.statusCode).toBe(200)
    expect(lifted.json().parentId).toBeNull()
  })

  /**
   * A move between collections that names no parent lands at the top of the
   * destination. Keeping the old parent would put the document's parent in
   * another collection, and a document whose parent is outside its own
   * collection has no scope chain at all — so every request for it, this one
   * included, would answer `500` from then on.
   */
  it('lifts a moved document to the top of its destination, and it stays readable', async () => {
    const second = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/collections`,
      cookies: admin,
      payload: { name: `Destination ${Date.now()}` },
    })
    expect(second.statusCode).toBe(201)
    const destination = second.json().id as string

    const parent = await createDocument('A parent that stays put')
    const child = await createDocument('A child that moves', { parentId: parent })

    const moved = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${child}`,
      cookies: admin,
      payload: { collectionId: destination },
    })
    expect(moved.statusCode).toBe(200)
    expect(moved.json()).toMatchObject({ collectionId: destination, parentId: null })

    // The proof that the chain is intact: reading it still works, rather
    // than failing as a tenancy tree that contradicts itself.
    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${child}/envelope`,
      cookies: admin,
    })
    expect(read.statusCode).toBe(200)
  })

  it('refuses a collection that does not exist at all', async () => {
    const id = await createDocument('Going nowhere')
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${id}`,
      cookies: admin,
      payload: { collectionId: UNKNOWN_DOCUMENT },
    })
    expect(response.statusCode).toBe(404)
  })

  it('refuses a parent that does not exist at all', async () => {
    const id = await createDocument('Orphan maker')
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${id}`,
      cookies: admin,
      payload: { parentId: UNKNOWN_DOCUMENT },
    })
    expect(response.statusCode).toBe(404)
  })

  /**
   * The destination exists and the caller — an instance admin — may manage
   * it, so only the use case can refuse: a document and its collection have
   * to be in one workspace, or the scope chain contradicts itself.
   */
  it('refuses a destination in another workspace, even to somebody who may manage it', async () => {
    const elsewhere = await harness.deps.uow.repos.workspaces.create({
      id: harness.deps.ids.uuid() as WorkspaceId,
      unitId: tenancy.unitId,
      name: 'Another workspace',
      slug: `another-${Date.now()}`,
      now: harness.clock.now(),
    })
    const theirCollection = await harness.deps.uow.repos.collections.create({
      id: harness.deps.ids.uuid(),
      workspaceId: elsewhere.id,
      name: 'Theirs',
      slug: 'theirs',
      now: harness.clock.now(),
    })
    const theirDocument = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${elsewhere.id}/documents`,
      cookies: admin,
      payload: { collectionId: theirCollection.id, title: 'Their document' },
    })
    expect(theirDocument.statusCode).toBe(201)

    const id = await createDocument('Trying to emigrate')
    const movedCollection = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${id}`,
      cookies: admin,
      payload: { collectionId: theirCollection.id },
    })
    expect(movedCollection.statusCode).toBe(404)
    expect(movedCollection.json().error.message).toContain('collection')

    const movedParent = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${id}`,
      cookies: admin,
      payload: { parentId: theirDocument.json().document.id },
    })
    expect(movedParent.statusCode).toBe(404)
    expect(movedParent.json().error.message).toContain('parent')
  })

  it('refuses a parent in a different collection from the destination', async () => {
    const other = await harness.deps.uow.repos.collections.create({
      id: harness.deps.ids.uuid(),
      workspaceId: tenancy.workspaceId,
      name: 'Somewhere else',
      slug: `somewhere-else-${Date.now()}`,
      now: harness.clock.now(),
    })
    const elsewhere = await harness.app.inject({
      method: 'POST',
      url: `/api/workspaces/${tenancy.workspaceId}/documents`,
      cookies: editor,
      payload: { collectionId: other.id, title: 'Over here' },
    })
    expect(elsewhere.statusCode).toBe(201)

    const id = await createDocument('Wants a far-away parent')
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${id}`,
      cookies: admin,
      payload: { parentId: elsewhere.json().document.id },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('parent_outside_collection')
  })

  it('refuses a cycle', async () => {
    const parent = await createDocument('Top')
    const child = await createDocument('Bottom')
    await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${child}`,
      cookies: admin,
      payload: { parentId: parent },
    })

    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${parent}`,
      cookies: admin,
      payload: { parentId: child },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('parent_cycle')
  })

  it('needs manage at the destination as well as at the source', async () => {
    const parent = await createDocument('A parent')
    const child = await createDocument('A child')
    // The editor may not manage either, so the move is refused before the
    // destination is even considered.
    expect(
      (
        await harness.app.inject({
          method: 'PATCH',
          url: `/api/documents/${child}`,
          cookies: editor,
          payload: { parentId: parent },
        })
      ).statusCode,
    ).toBe(403)
  })
})

describe('deleting a document', () => {
  /**
   * Review finding L6: the delete went straight to the repository, so nothing
   * recorded who did it or what went with it.
   */
  it('deletes it, lifts its children, and says so in the audit log', async () => {
    const parent = await createDocument('Doomed parent')
    const child = await createDocument('Its child')
    await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${child}`,
      cookies: admin,
      payload: { parentId: parent },
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/documents/${parent}`,
      cookies: admin,
    })
    expect(deleted.statusCode).toBe(204)

    const { rows } = await harness.database.pool.query<{ metadata: { childrenLifted: number } }>(
      "SELECT metadata FROM audit_events WHERE type = 'document.deleted' AND target_id = $1",
      [parent],
    )
    expect(rows[0]?.metadata).toMatchObject({ title: 'Doomed parent', childrenLifted: 1 })

    // The child is still there, at the root of its collection.
    const orphan = await get(`/api/documents/${child}`, viewer)
    expect(orphan.statusCode).toBe(200)
    expect(orphan.json().parentId).toBeNull()
  })
})

/**
 * Human-readable addresses (ADR-035): every document route takes the short
 * key as readily as the UUID, with or without the words in front of it, and
 * the UUID keeps working for ever (ADR-033).
 */
describe('addressing a document by its short key', () => {
  it('answers to the key, to the words and the key, and to the UUID', async () => {
    const id = await createDocument('Regional failover runbook')
    const document = (await get(`/api/documents/${id}`, editor)).json()
    const key = document.shortId as string

    expect(key).toMatch(/^[0-9a-z]{10}$/)
    expect(document.slug).toBe('regional-failover-runbook')

    for (const reference of [key, `${document.slug}-${key}`, `whatever-it-used-to-be-${key}`, id]) {
      const response = await get(`/api/documents/${reference}`, editor)
      expect(response.statusCode).toBe(200)
      expect(response.json().id).toBe(id)
    }
  })

  it('takes the key on every route that takes an id', async () => {
    const id = await createDocument('Addressable everywhere')
    const key = (await get(`/api/documents/${id}`, editor)).json().shortId as string
    await writeDraft(id, MARKDOWN, 0)
    expect((await publish(id, null)).statusCode).toBe(200)

    for (const suffix of ['/content', '/rendered', '/envelope', '/history', '/draft']) {
      const response = await get(`/api/documents/${key}${suffix}`, editor)
      expect([200, 304]).toContain(response.statusCode)
    }

    // A write route resolves it too: the lock is acquired by key.
    const acquired = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${key}/lock/acquire`,
      cookies: editor,
    })
    expect(acquired.statusCode).toBe(200)
    await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${key}/lock/release`,
      cookies: editor,
    })
  })

  it('answers 404 for a key nothing holds and for a reference that is neither', async () => {
    expect((await get('/api/documents/zzzzzzzzzz', editor)).statusCode).toBe(404)
    expect((await get('/api/documents/not-a-reference', editor)).statusCode).toBe(404)
    expect((await get(`/api/documents/${UNKNOWN_DOCUMENT}`, editor)).statusCode).toBe(404)
  })

  it('keeps the key across a rename while the words follow the title', async () => {
    const id = await createDocument('Before the rename')
    const key = (await get(`/api/documents/${id}`, editor)).json().shortId as string

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/documents/${key}`,
      cookies: admin,
      payload: { title: 'After the rename' },
    })

    const document = (await get(`/api/documents/${key}`, editor)).json()
    expect(document.shortId).toBe(key)
    expect(document.slug).toBe('after-the-rename')
  })
})
