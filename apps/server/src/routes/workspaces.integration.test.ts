import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGrant, MAX_PATH_ATTEMPTS } from '@quill/application'
import { parseDocument } from '@quill/markdown'
import type { CollectionId, DocumentId, WorkspaceId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Creating documents and reading the navigation tree
 * (`docs/architecture/api-contract-m2.md`), including what each reader is
 * shown and what a template does.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>
let runbooks: CollectionId

const UNKNOWN = '00000000-0000-4000-8000-0000000000ff'

const TEMPLATE = [
  '---',
  'template:',
  '  name: Architecture decision record',
  '  version: 2',
  '  questions:',
  '    - id: securityReview',
  '      label: Does this touch authentication?',
  '      type: boolean',
  '  sections:',
  '    - heading: Decision',
  '      required: true',
  '  metadata:',
  '    type: adr',
  '---',
  '',
  '# {{ answers.title }}',
  '',
  '## Decision',
  '',
  ':::placeholder',
  'What did we decide?',
  ':::',
].join('\n')

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)

  const collection = await harness.deps.uow.repos.collections.create({
    id: harness.deps.ids.uuid() as CollectionId,
    workspaceId: tenancy.workspaceId,
    name: 'Runbooks',
    slug: 'runbooks',
    now: harness.clock.now(),
  })
  runbooks = collection.id as CollectionId
}, 30_000)

afterAll(async () => {
  await harness.close()
})

async function create(payload: Record<string, unknown>, cookies = editor) {
  return await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies,
    payload,
  })
}

describe('creating a document', () => {
  it('creates a blank document with a draft, a path, and a slug', async () => {
    const response = await create({
      collectionId: tenancy.collectionId,
      title: 'Service catalogue',
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      document: {
        title: 'Service catalogue',
        slug: 'service-catalogue',
        path: 'architecture/service-catalogue.md',
        status: 'draft',
        headRevision: null,
        collectionId: tenancy.collectionId,
      },
      draft: { draftVersion: 0, baseRevision: null },
      requiredSections: [],
      warnings: [],
    })
  })

  it('nests a document under a parent in the same collection', async () => {
    const parent = await create({ collectionId: runbooks, title: 'Database runbooks' })
    const parentId = parent.json().document.id as DocumentId

    const child = await create({ collectionId: runbooks, parentId, title: 'Failover' })
    expect(child.statusCode).toBe(201)
    expect(child.json().document.path).toBe('runbooks/database-runbooks/failover.md')

    const elsewhere = await create({
      collectionId: tenancy.collectionId,
      parentId,
      title: 'Wrong collection',
    })
    expect(elsewhere.statusCode).toBe(409)
    expect(elsewhere.json().error.code).toBe('parent_not_found')
  })

  it('scaffolds from a published template and reports what is still a placeholder', async () => {
    const template = await create({ collectionId: runbooks, title: 'ADR template' })
    const templateId = template.json().document.id as DocumentId
    await harness.deps.uow.repos.drafts.init({
      documentId: templateId,
      baseRevision: null,
      ast: draftOf(TEMPLATE),
      now: harness.clock.now(),
    })
    const published = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${templateId}/publish`,
      cookies: editor,
      // A document's first publish is based on nothing, whatever else the
      // workspace has published since (ADR-015).
      payload: { base: null },
    })
    expect(published.statusCode).toBe(200)

    const created = await create({
      collectionId: tenancy.collectionId,
      title: 'Use Postgres for everything',
      templateId,
      answers: { securityReview: false, title: 'Use Postgres for everything' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().requiredSections).toEqual(['Decision'])
    expect(created.json().document.templateVersion).toBe(2)
    expect(created.json().warnings).toEqual([])
  })

  it('passes a template warning back to the author', async () => {
    const template = await create({ collectionId: runbooks, title: 'Template with a typo' })
    const templateId = template.json().document.id as DocumentId
    await harness.deps.uow.repos.drafts.init({
      documentId: templateId,
      baseRevision: null,
      // The condition names a question the template never declares. It sits in
      // the declaration rather than in the body because a `:::when` block is
      // resolved at creation and removed at publish, so a published template
      // never carries one (`stripAuthoringBlocks`).
      ast: draftOf(
        [
          '---',
          'template:',
          '  name: Typo',
          '  version: 1',
          '  sections:',
          '    - heading: Conditional',
          '      required: true',
          '      when: neverDeclared',
          '---',
          '',
          '## Conditional',
        ].join('\n'),
      ),
      now: harness.clock.now(),
    })
    const publishedTemplate = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${templateId}/publish`,
      cookies: editor,
      payload: { base: null },
    })
    expect(publishedTemplate.statusCode).toBe(200)

    const created = await create({
      collectionId: tenancy.collectionId,
      title: 'From a template with a typo',
      templateId,
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().warnings).toEqual([{ code: 'unknown-question', detail: 'neverDeclared' }])
  })

  it('refuses a title whose every path is taken, rather than trying for ever', async () => {
    // Every candidate path is claimed behind the unique `(workspace_id, path)`
    // index, and the candidates are bounded: a title that cannot be placed
    // ends in an answer the author can act on rather than in a spin.
    for (let taken = 0; taken < MAX_PATH_ATTEMPTS; taken++) {
      const created = await create({ collectionId: tenancy.collectionId, title: 'Crowded' })
      expect(created.statusCode).toBe(201)
    }

    const refused = await create({ collectionId: tenancy.collectionId, title: 'Crowded' })
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({
      code: 'path_unavailable',
      details: { attempts: MAX_PATH_ATTEMPTS },
    })
  })

  it('reports a collection and a template it cannot find, and refuses a reader', async () => {
    expect((await create({ collectionId: UNKNOWN, title: 'Nowhere' })).statusCode).toBe(404)
    expect(
      (
        await create({
          collectionId: tenancy.collectionId,
          title: 'From nothing',
          templateId: UNKNOWN,
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (await create({ collectionId: tenancy.collectionId, title: 'Not yours' }, viewer)).statusCode,
    ).toBe(403)
  })
})

describe('the workspace tree', () => {
  it('lists collections with their documents nested', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/tree`,
      cookies: editor,
    })
    expect(response.statusCode).toBe(200)
    const collections = response.json().collections as {
      name: string
      documents: { title: string; children: { title: string }[] }[]
    }[]
    expect(collections.map((collection) => collection.name)).toEqual(['Architecture', 'Runbooks'])

    const runbookTree = collections.find((collection) => collection.name === 'Runbooks')
    const database = runbookTree?.documents.find(
      (document) => document.title === 'Database runbooks',
    )
    expect(database?.children.map((child) => child.title)).toEqual(['Failover'])
  })

  it('shows an instance admin everything and a stranger nothing', async () => {
    const asAdmin = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/tree`,
      cookies: admin,
    })
    expect(asAdmin.statusCode).toBe(200)
    expect(asAdmin.json().collections[0].documents.length).toBeGreaterThan(0)

    const asStranger = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/tree`,
      cookies: outsider,
    })
    expect(asStranger.statusCode).toBe(403)
  })

  it('hides a document a deny at document scope carved out, from the tree and the flat list alike', async () => {
    const secret = await create({ collectionId: tenancy.collectionId, title: 'Salaries' })
    const secretId = secret.json().document.id as DocumentId
    const denied = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.viewer,
      scopeKind: 'document',
      scopeId: secretId,
      role: 'viewer',
      effect: 'deny',
      createdBy: tenancy.admin,
    })
    expect(denied.kind).toBe('created')

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/tree`,
      cookies: viewer,
    })
    const titles = (response.json().collections as { documents: { title: string }[] }[]).flatMap(
      (collection) => collection.documents.map((document) => document.title),
    )
    expect(titles).not.toContain('Salaries')
    expect(titles).toContain('Service catalogue')

    // The same question, asked flat: a reader must not learn from one endpoint
    // what the other hides.
    const flat = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/documents`,
      cookies: viewer,
    })
    expect(flat.statusCode).toBe(200)
    const listed = (flat.json() as { id: string; title: string }[]).map(
      (document) => document.title,
    )
    expect(listed).not.toContain('Salaries')
    expect(listed).toContain('Service catalogue')

    // An instance admin still sees everything.
    const asAdmin = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/documents`,
      cookies: admin,
    })
    expect((asAdmin.json() as { title: string }[]).map((document) => document.title)).toContain(
      'Salaries',
    )
  })

  it('keeps a document carved out of a public collection visible to members', async () => {
    const published = await create({ collectionId: runbooks, title: 'Release notes' })
    const publishedId = published.json().document.id as DocumentId

    for (const grant of [
      { scopeKind: 'collection', scopeId: runbooks, effect: 'allow' },
      { scopeKind: 'document', scopeId: publishedId, effect: 'deny' },
    ] as const) {
      const written = await createGrant(harness.deps, {
        principalKind: 'public',
        principalId: null,
        role: 'viewer',
        createdBy: tenancy.admin,
        ...grant,
      })
      expect(written.kind).toBe('created')
    }

    // The viewer reaches it through their own workspace grant, not through
    // `public`, so unpublishing the one document does not hide it from them.
    const asViewer = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/documents`,
      cookies: viewer,
    })
    expect((asViewer.json() as { title: string }[]).map((document) => document.title)).toContain(
      'Release notes',
    )
  })

  it('refuses to store a deny above document scope', async () => {
    const rejected = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.viewer,
      scopeKind: 'collection',
      scopeId: tenancy.collectionId,
      role: 'viewer',
      effect: 'deny',
      createdBy: tenancy.admin,
    })
    expect(rejected).toEqual({
      kind: 'rejected',
      violations: [{ kind: 'deny-outside-document-scope', scope: 'collection' }],
    })
  })

  it('404s a workspace that does not exist', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${UNKNOWN}/tree`,
      cookies: admin,
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('workspace administration', () => {
  it('lets an instance admin create, read, rename, and delete a workspace', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: admin,
      payload: { unitId: tenancy.unitId, name: 'Support', slug: 'support' },
    })
    expect(created.statusCode).toBe(201)
    const id = created.json().id as string

    expect(
      (await harness.app.inject({ method: 'GET', url: `/api/workspaces/${id}`, cookies: admin }))
        .statusCode,
    ).toBe(200)

    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}`,
      cookies: admin,
      payload: { name: 'Customer support' },
    })
    expect(renamed.json().name).toBe('Customer support')

    expect(
      (
        await harness.app.inject({
          method: 'DELETE',
          url: `/api/workspaces/${id}`,
          cookies: admin,
        })
      ).statusCode,
    ).toBe(204)
  })

  it('refuses workspace creation, renaming, and deletion to an editor', async () => {
    expect(
      (
        await harness.app.inject({
          method: 'POST',
          url: '/api/workspaces',
          cookies: editor,
          payload: { unitId: tenancy.unitId, name: 'Not allowed', slug: 'not-allowed' },
        })
      ).statusCode,
    ).toBe(403)

    expect(
      (
        await harness.app.inject({
          method: 'PATCH',
          url: `/api/workspaces/${tenancy.workspaceId}`,
          cookies: editor,
          payload: { name: 'Renamed' },
        })
      ).statusCode,
    ).toBe(403)

    expect(
      (
        await harness.app.inject({
          method: 'DELETE',
          url: `/api/workspaces/${tenancy.workspaceId}`,
          cookies: editor,
        })
      ).statusCode,
    ).toBe(403)
  })

  it('lists the documents of a workspace to anyone who may read it', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/documents`,
      cookies: viewer,
    })
    expect(response.statusCode).toBe(200)
    expect((response.json() as { title: string }[]).length).toBeGreaterThan(0)
  })
})

describe('listing the workspaces a caller can see', () => {
  async function list(cookies: Record<string, string>) {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/workspaces',
      cookies,
    })
    expect(response.statusCode).toBe(200)
    return response.json() as { name: string; unit: { name: string; path: string[] } }[]
  }

  it('shows nothing to a signed-in user who holds no grant', async () => {
    expect(await list(outsider)).toEqual([])
  })

  it('shows a member only the workspaces they can reach', async () => {
    expect(await list(editor)).toEqual([
      {
        id: tenancy.workspaceId,
        unitId: tenancy.unitId,
        name: 'Engineering',
        slug: 'engineering',
        createdAt: harness.clock.now().toISOString(),
        unit: { id: tenancy.unitId, name: 'Acme', path: ['Acme'] },
      },
    ])
  })

  it('shows an instance admin every workspace, including one nobody is granted', async () => {
    const other = await harness.deps.uow.repos.workspaces.create({
      id: harness.deps.ids.uuid() as WorkspaceId,
      unitId: tenancy.unitId,
      name: 'Zeta',
      slug: 'zeta',
      now: harness.clock.now(),
    })
    try {
      expect((await list(admin)).map((workspace) => workspace.name)).toEqual([
        'Engineering',
        'Zeta',
      ])
      // The same workspace stays invisible to a member with no grant on it.
      expect((await list(editor)).map((workspace) => workspace.name)).toEqual(['Engineering'])
    } finally {
      await harness.deps.uow.repos.workspaces.delete(other.id)
    }
  })

  it('requires a session', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/workspaces' })
    expect(response.statusCode).toBe(401)
  })
})

/** The draft envelope the editor writes (ADR-021). */
function draftOf(markdown: string): unknown {
  const { frontMatter, ast } = parseDocument(markdown)
  return { version: 1, frontMatter, ast }
}

/**
 * Human-readable addresses (ADR-035): a workspace answers to its slug as well
 * as to its id, a slug it has retired keeps redirecting, and everything a
 * navigation entry needs to build a link travels with it.
 */
describe('addressing a workspace by its slug', () => {
  async function read(reference: string, cookies = admin) {
    return await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${reference}`,
      cookies,
    })
  }

  it('answers to the slug and to the id, and 404s for a slug nothing uses', async () => {
    const bySlug = await read('engineering')
    expect(bySlug.statusCode).toBe(200)
    expect(bySlug.json().id).toBe(tenancy.workspaceId)

    expect((await read(tenancy.workspaceId)).json().id).toBe(tenancy.workspaceId)
    expect((await read('no-such-workspace')).statusCode).toBe(404)
    expect((await read(UNKNOWN)).statusCode).toBe(404)
  })

  it('takes the slug on the routes that hang off a workspace', async () => {
    for (const url of [
      '/api/workspaces/engineering/tree',
      '/api/workspaces/engineering/documents',
      '/api/workspaces/engineering/collections',
    ]) {
      expect((await harness.app.inject({ method: 'GET', url, cookies: admin })).statusCode).toBe(
        200,
      )
    }
  })

  it('keeps the old slug working after a workspace moves to a new one', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: admin,
      payload: { unitId: tenancy.unitId, name: 'Design', slug: 'design' },
    })
    const id = created.json().id as string

    const moved = await harness.app.inject({
      method: 'PATCH',
      url: '/api/workspaces/design',
      cookies: admin,
      payload: { name: 'Design system', slug: 'design-system' },
    })
    expect(moved.statusCode).toBe(200)
    expect(moved.json().slug).toBe('design-system')

    expect((await read('design-system')).json().id).toBe(id)
    // The forwarding address: a link written before the move still resolves.
    expect((await read('design')).json().id).toBe(id)

    expect(
      (
        await harness.app.inject({
          method: 'PATCH',
          url: `/api/workspaces/${id}`,
          cookies: admin,
          payload: { name: 'Design system', slug: 'engineering' },
        })
      ).statusCode,
    ).toBe(409)

    await harness.app.inject({ method: 'DELETE', url: `/api/workspaces/${id}`, cookies: admin })
  })

  it('reports a key it cannot allocate rather than drawing for ever', async () => {
    const first = await create({ collectionId: runbooks, title: 'Key hog' })
    const taken = first.json().document.shortId as string

    // A generator that has stopped being random: five draws, all of them a
    // key somebody already holds (ADR-035). The request was well formed, so
    // the platform says so plainly rather than looping.
    const generator = harness.deps.ids
    const drawKey = generator.shortId
    generator.shortId = () => taken
    try {
      const response = await create({ collectionId: runbooks, title: 'Second' })
      expect(response.statusCode).toBe(500)
      expect(response.json().error.code).toBe('short_id_unavailable')
    } finally {
      generator.shortId = drawKey
    }
  })

  it('gives every document and every tree node the key and the words its link needs', async () => {
    const created = await create({ collectionId: runbooks, title: 'Failover runbook' })
    expect(created.statusCode).toBe(201)
    expect(created.json().document).toMatchObject({
      shortId: expect.stringMatching(/^[0-9a-z]{10}$/),
      slug: 'failover-runbook',
    })

    const tree = await harness.app.inject({
      method: 'GET',
      url: '/api/workspaces/engineering/tree',
      cookies: admin,
    })
    const nodes = (tree.json().collections as { documents: Record<string, string>[] }[]).flatMap(
      (collection) => collection.documents,
    )
    const node = nodes.find((entry) => entry['title'] === 'Failover runbook')
    expect(node).toMatchObject({
      shortId: created.json().document.shortId,
      slug: 'failover-runbook',
    })
  })
})
