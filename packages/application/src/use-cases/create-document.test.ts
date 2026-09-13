import { beforeEach, describe, expect, it } from 'vitest'
import { canonicalShortId, documentId, userId, workspaceId } from '@quill/domain'

import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import type { FakeContentStore } from '../test-support/fake-content-store.ts'
import { createFakeDocumentFormat, serialise } from '../test-support/fake-document-format.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createDocument, MAX_SHORT_ID_ATTEMPTS } from './create-document.ts'
import { MAX_PATH_ATTEMPTS } from './document-path.ts'
import type { CreateDocumentDependencies } from './create-document.ts'
import { readDraftContent } from './publish-document.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const AUTHOR = userId('00000000-0000-4000-8000-000000000001')
const TEMPLATE = documentId('00000000-0000-4000-8000-000000000901')
const MISSING = documentId('00000000-0000-4000-8000-0000000009ff')

let uow: InMemoryUnitOfWork
let contentStore: FakeContentStore
let deps: CreateDocumentDependencies

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  contentStore = createFakeContentStore()
  deps = {
    uow,
    contentStore,
    format: createFakeDocumentFormat(),
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
  }
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'architecture',
    workspaceId: WORKSPACE,
    name: 'Architecture',
    slug: 'architecture',
    now: NOW,
  })
})

const command = {
  workspaceId: WORKSPACE,
  collectionId: 'architecture',
  parentId: null,
  title: 'Authentication architecture',
  createdBy: AUTHOR,
}

describe('createDocument: paths', () => {
  it('numbers the path when another document already holds it', async () => {
    const first = await createDocument(deps, {
      workspaceId: WORKSPACE,
      collectionId: 'architecture',
      parentId: null,
      title: 'Overview',
      createdBy: AUTHOR,
    })
    const second = await createDocument(deps, {
      workspaceId: WORKSPACE,
      collectionId: 'architecture',
      parentId: null,
      title: 'Overview',
      createdBy: AUTHOR,
    })
    expect(first.kind === 'created' && first.document.path).toBe('architecture/overview.md')
    expect(second.kind === 'created' && second.document.path).toBe('architecture/overview-2.md')
  })

  it('gives up after a bounded number of attempts rather than spinning', async () => {
    for (let taken = 0; taken < MAX_PATH_ATTEMPTS; taken++) {
      const created = await createDocument(deps, {
        workspaceId: WORKSPACE,
        collectionId: 'architecture',
        parentId: null,
        title: 'Overview',
        createdBy: AUTHOR,
      })
      expect(created.kind).toBe('created')
    }

    expect(
      await createDocument(deps, {
        workspaceId: WORKSPACE,
        collectionId: 'architecture',
        parentId: null,
        title: 'Overview',
        createdBy: AUTHOR,
      }),
    ).toEqual({ kind: 'path-unavailable', title: 'Overview', attempts: MAX_PATH_ATTEMPTS })
  })
})

describe('createDocument', () => {
  it('creates a blank document, its draft, and a DocumentCreated event', async () => {
    const result = await createDocument(deps, command)
    expect(result.kind).toBe('created')
    if (result.kind !== 'created') return

    expect(result.document.path).toBe('architecture/authentication-architecture.md')
    expect(result.document.slug).toBe('authentication-architecture')
    expect(result.document.status).toBe('draft')
    expect(result.document.headRevision).toBeNull()
    expect(result.draft.baseRevision).toBeNull()

    const content = readDraftContent(result.draft.ast)
    expect(content?.frontMatter).toMatchObject({ id: result.document.id, title: command.title })
    expect(uow.events.map((event) => event.type)).toEqual(['DocumentCreated'])
    expect(uow.events[0]?.payload).toMatchObject({ documentId: result.document.id, version: 1 })
  })

  it('numbers a second document that would take the same path', async () => {
    await createDocument(deps, command)
    const second = await createDocument(deps, command)
    expect(second.kind === 'created' && second.document.path).toBe(
      'architecture/authentication-architecture-2.md',
    )
  })

  it('nests a child inside its parent', async () => {
    const parent = await createDocument(deps, command)
    expect(parent.kind).toBe('created')
    if (parent.kind !== 'created') return

    const child = await createDocument(deps, {
      ...command,
      parentId: parent.document.id,
      title: 'Token exchange',
    })
    expect(child.kind === 'created' && child.document.path).toBe(
      'architecture/authentication-architecture/token-exchange.md',
    )
    expect(child.kind === 'created' && child.document.parentId).toBe(parent.document.id)
  })

  it('scaffolds from a template, substitutes its answers, and reports required sections', async () => {
    await contentStore.publish({
      workspaceId: WORKSPACE,
      base: null,
      author: { name: 'Quill', email: 'quill@example.com' },
      changes: [
        {
          kind: 'write',
          documentId: TEMPLATE,
          path: 'templates/adr.md',
          markdown: serialise(
            {
              id: TEMPLATE,
              template: { name: 'ADR', version: 3 },
              requiredSections: ['Decision'],
            },
            '# {{ answers.title }}\n\n# Decision\n\n::placeholder what did we decide?',
          ),
        },
      ],
    })

    const result = await createDocument(deps, {
      ...command,
      templateId: TEMPLATE,
      answers: { title: 'Use Postgres' },
    })
    expect(result.kind).toBe('created')
    if (result.kind !== 'created') return

    expect(result.requiredSections).toEqual(['Decision'])
    expect(result.warnings.map((warning) => warning.code)).toEqual(['placeholder-remains'])
    expect(result.document.templateId).toBe(TEMPLATE)
    expect(result.document.templateVersion).toBe(3)
    const content = readDraftContent(result.draft.ast)
    expect(content?.ast).toEqual({
      body: '# Use Postgres\n\n# Decision\n\n::placeholder what did we decide?',
    })
  })

  it('reports a collection, parent, or template it cannot find', async () => {
    expect(await createDocument(deps, { ...command, collectionId: 'nope' })).toEqual({
      kind: 'collection-not-found',
      collectionId: 'nope',
    })
    expect(await createDocument(deps, { ...command, parentId: MISSING })).toEqual({
      kind: 'parent-not-found',
      parentId: MISSING,
    })
    expect(await createDocument(deps, { ...command, templateId: MISSING })).toEqual({
      kind: 'template-not-found',
      templateId: MISSING,
    })
  })

  it('refuses a collection that belongs to another workspace', async () => {
    const other = workspaceId('00000000-0000-4000-8000-000000000102')
    await uow.repos.collections.create({
      id: 'elsewhere',
      workspaceId: other,
      name: 'Elsewhere',
      slug: 'elsewhere',
      now: NOW,
    })
    expect(await createDocument(deps, { ...command, collectionId: 'elsewhere' })).toEqual({
      kind: 'collection-not-found',
      collectionId: 'elsewhere',
    })
  })

  it('refuses a parent in another collection, which would place the document twice', async () => {
    const parent = await createDocument(deps, command)
    expect(parent.kind).toBe('created')
    if (parent.kind !== 'created') return
    await uow.repos.collections.create({
      id: 'runbooks',
      workspaceId: WORKSPACE,
      name: 'Runbooks',
      slug: 'runbooks',
      now: NOW,
    })

    expect(
      await createDocument(deps, {
        ...command,
        collectionId: 'runbooks',
        parentId: parent.document.id,
      }),
    ).toEqual({ kind: 'parent-not-found', parentId: parent.document.id })
  })

  it('records no template version when the created front matter names none', async () => {
    for (const template of ['not-an-object', { name: 'ADR' }]) {
      const format = createFakeDocumentFormat({ defaults: { template } })
      const result = await createDocument({ ...deps, format }, command)
      expect(result.kind === 'created' && result.document.templateVersion).toBeNull()
    }
  })

  it('instantiates a template that asks nothing', async () => {
    await contentStore.publish({
      workspaceId: WORKSPACE,
      base: null,
      author: { name: 'Quill', email: 'quill@example.com' },
      changes: [
        {
          kind: 'write',
          documentId: TEMPLATE,
          path: 'templates/blank.md',
          markdown: serialise({ id: TEMPLATE }, '# A template with no questions'),
        },
      ],
    })

    const result = await createDocument(deps, { ...command, templateId: TEMPLATE })
    expect(result.kind).toBe('created')
    if (result.kind !== 'created') return
    expect(result.requiredSections).toEqual([])
  })
})

describe('createDocument: short keys', () => {
  it('gives every document a key of its own, in canonical form', async () => {
    const first = await createDocument(deps, { ...command, title: 'One' })
    const second = await createDocument(deps, { ...command, title: 'Two' })
    if (first.kind !== 'created' || second.kind !== 'created') throw new Error('not created')

    expect(canonicalShortId(first.document.shortId)).toBe(first.document.shortId)
    expect(first.document.shortId).not.toBe(second.document.shortId)
    expect(await uow.repos.documents.findByShortId(first.document.shortId)).toMatchObject({
      id: first.document.id,
    })
  })

  it('draws another key when the one it drew is already taken', async () => {
    const taken = await createDocument(deps, { ...command, title: 'One' })
    if (taken.kind !== 'created') throw new Error('not created')

    // A generator that hands out a key somebody already holds, once.
    let draws = 0
    const collidingIds = {
      uuid: () => deps.ids.uuid(),
      shortId: () => {
        draws += 1
        return draws === 1 ? taken.document.shortId : deps.ids.shortId()
      },
    }

    const created = await createDocument(
      { ...deps, ids: collidingIds },
      { ...command, title: 'Two' },
    )
    expect(created.kind).toBe('created')
    expect(created.kind === 'created' && created.document.shortId).not.toBe(taken.document.shortId)
    expect(draws).toBe(2)
  })

  it('gives up after a bounded number of draws rather than spinning', async () => {
    const taken = await createDocument(deps, { ...command, title: 'One' })
    if (taken.kind !== 'created') throw new Error('not created')

    let draws = 0
    const stuckIds = {
      uuid: () => deps.ids.uuid(),
      shortId: () => {
        draws += 1
        return taken.document.shortId
      },
    }

    expect(await createDocument({ ...deps, ids: stuckIds }, { ...command, title: 'Two' })).toEqual({
      kind: 'short-id-unavailable',
      attempts: MAX_SHORT_ID_ATTEMPTS,
    })
    expect(draws).toBe(MAX_SHORT_ID_ATTEMPTS)
  })
})
