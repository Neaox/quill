import { beforeEach, describe, expect, it } from 'vitest'
import {
  documentId,
  PUBLIC_PRINCIPAL,
  revisionId,
  userPrincipal,
  userId,
  workspaceId,
} from '@quill/domain'
import type { DocumentId, Principal } from '@quill/domain'

import type { RepositoryBundle, UnitOfWork, WorkspaceRow } from '../ports/persistence.ts'
import { aShortId } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { ChildPageNode, ChildPagesCache, ChildPagesStructure } from './child-pages.ts'
import { childPagesKey, listChildPages } from './child-pages.ts'

const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const READER = userId('00000000-0000-4000-8000-000000000001')
const id = (n: number): DocumentId =>
  documentId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const GUIDE = id(1)
const INSTALL = id(2)
const LINUX = id(3)
const DEBIAN = id(4)
const UPGRADE = id(5)
const SECRET = id(6)
const UNDER_SECRET = id(7)
const DRAFT = id(8)
const OUTSIDE = id(9)

const reader: readonly Principal[] = [userPrincipal(READER), PUBLIC_PRINCIPAL]

let uow: InMemoryUnitOfWork
let workspace: WorkspaceRow

async function document(
  documentKey: DocumentId,
  parentId: DocumentId | null,
  title: string,
  minute: number,
  published = true,
): Promise<void> {
  const at = new Date(Date.UTC(2026, 0, 1, 0, minute))
  await uow.repos.documents.create({
    id: documentKey,
    shortId: aShortId(),
    workspaceId: WORKSPACE,
    collectionId: 'guides',
    parentId,
    slug: title.toLowerCase(),
    path: `guides/${title}.md`,
    title,
    status: published ? 'published' : 'draft',
    templateId: null,
    templateVersion: null,
    now: at,
  })
  if (published) {
    await uow.repos.documents.update(documentKey, { headRevision: revisionId('a'.repeat(40)) }, at)
  }
}

async function grant(
  scopeKind: 'workspace' | 'document',
  scopeId: string,
  effect: 'allow' | 'deny',
  principalKind: 'user' | 'public' = 'user',
): Promise<void> {
  await uow.repos.grants.create({
    id: `grant-${scopeId}-${effect}-${principalKind}`,
    principalKind,
    principalId: principalKind === 'user' ? READER : null,
    scopeKind,
    scopeId,
    role: 'viewer',
    effect,
    createdBy: null,
    now: new Date(0),
  })
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  await uow.repos.units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: new Date(0),
  })
  workspace = await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: new Date(0),
  })
  await uow.repos.collections.create({
    id: 'guides',
    workspaceId: WORKSPACE,
    name: 'Guides',
    slug: 'guides',
    now: new Date(0),
  })
  await document(GUIDE, null, 'Guide', 0)
  await document(UPGRADE, GUIDE, 'Upgrade', 1)
  await document(INSTALL, GUIDE, 'Install', 2)
  await document(LINUX, INSTALL, 'Linux', 3)
  await document(DEBIAN, LINUX, 'Debian', 4)
  await document(SECRET, GUIDE, 'Salaries', 5)
  await document(UNDER_SECRET, SECRET, 'Bands', 6)
  await document(DRAFT, GUIDE, 'Roadmap', 7, false)
  await document(OUTSIDE, null, 'Elsewhere', 8)
  uow.summaries.set(INSTALL, { documentId: INSTALL, summary: 'How to install.', icon: '📦' })
  await grant('workspace', WORKSPACE, 'allow')
  await grant('document', SECRET, 'deny')
})

async function guide() {
  const parent = await uow.repos.documents.findById(GUIDE)
  if (parent === null) throw new Error('no guide')
  return parent
}

function titles(nodes: readonly ChildPageNode[]): unknown {
  return nodes.map((node) =>
    node.children.length === 0
      ? node.document.title
      : { [node.document.title]: titles(node.children) },
  )
}

async function list(
  options: { depth?: number; sort?: 'manual' | 'title' | 'updated' } = {},
  audience: Parameters<typeof listChildPages>[1]['audience'] = {
    kind: 'reader',
    identities: reader,
    seesEverything: false,
  },
  deps: { uow: UnitOfWork; childPagesCache?: ChildPagesCache } = { uow },
): Promise<readonly ChildPageNode[]> {
  const result = await listChildPages(deps, {
    parent: await guide(),
    workspace,
    options: { depth: options.depth ?? 1, sort: options.sort ?? 'manual' },
    audience,
  })
  if (result.kind !== 'pages') throw new Error(result.kind)
  return result.pages
}

describe('listChildPages', () => {
  it('lists the children a reader may read, in the navigation’s order, drafts included', async () => {
    expect(titles(await list())).toEqual(['Upgrade', 'Install', 'Roadmap'])
  })

  it('goes as deep as it is asked, and no deeper', async () => {
    expect(titles(await list({ depth: 2 }))).toEqual(['Upgrade', { Install: ['Linux'] }, 'Roadmap'])
    expect(titles(await list({ depth: 3 }))).toEqual([
      'Upgrade',
      { Install: [{ Linux: ['Debian'] }] },
      'Roadmap',
    ])
    // Out of range is clamped to 1–6, never an error.
    expect(titles(await list({ depth: 0 }))).toEqual(['Upgrade', 'Install', 'Roadmap'])
    expect(titles(await list({ depth: 60 }))).toEqual(titles(await list({ depth: 6 })))
  })

  it('never lists a child the reader cannot read, nor anything reached through it', async () => {
    const pages = await list({ depth: 6 })
    const all = JSON.stringify(titles(pages))
    expect(all).not.toContain('Salaries')
    expect(all).not.toContain('Bands')
  })

  it('lists everything for an instance administrator', async () => {
    const pages = await list({ depth: 2 }, { kind: 'reader', identities: [], seesEverything: true })
    expect(titles(pages)).toEqual([
      'Upgrade',
      { Install: ['Linux'] },
      { Salaries: ['Bands'] },
      'Roadmap',
    ])
  })

  it('lists nothing for a reader with no grant at all', async () => {
    expect(
      await list(
        {},
        {
          kind: 'reader',
          identities: [userPrincipal(userId('00000000-0000-4000-8000-0000000000ff'))],
          seesEverything: false,
        },
      ),
    ).toEqual([])
  })

  it('lists only published, public pages on the public site', async () => {
    expect(await list({}, { kind: 'public' })).toEqual([])
    await grant('workspace', WORKSPACE, 'allow', 'public')
    await grant('document', SECRET, 'deny', 'public')
    expect(titles(await list({ depth: 2 }, { kind: 'public' }))).toEqual([
      'Upgrade',
      { Install: ['Linux'] },
    ])
  })

  it('sorts by title, or by the most recently updated', async () => {
    expect(titles(await list({ sort: 'title' }))).toEqual(['Install', 'Roadmap', 'Upgrade'])
    await uow.repos.documents.update(UPGRADE, { title: 'Upgrade' }, new Date(Date.UTC(2026, 5, 1)))
    expect(titles(await list({ sort: 'updated' }))).toEqual(['Upgrade', 'Roadmap', 'Install'])
  })

  it('breaks a tie in title or in time by the navigation’s order', async () => {
    await document(id(50), GUIDE, 'Install', 9)
    const byTitle = await list({ sort: 'title' })
    expect(byTitle.map((page) => page.document.id).slice(0, 2)).toEqual([INSTALL, id(50)])
    const same = new Date(Date.UTC(2027, 0, 1))
    await uow.repos.documents.update(INSTALL, { title: 'Install' }, same)
    await uow.repos.documents.update(id(50), { title: 'Install' }, same)
    const byTime = await list({ sort: 'updated' })
    expect(byTime.map((page) => page.document.id).slice(0, 2)).toEqual([INSTALL, id(50)])
  })

  it('carries each page’s summary and icon, or none', async () => {
    const pages = await list()
    const install = pages.find((page) => page.document.id === INSTALL)
    expect(install).toMatchObject({ summary: 'How to install.', icon: '📦' })
    expect(pages[0]).toMatchObject({ summary: null, icon: null })
  })

  it('lists nothing under a document filed in no collection, but to an administrator', async () => {
    const parent = { ...(await guide()), collectionId: null }
    const result = await listChildPages(
      { uow },
      {
        parent,
        workspace,
        options: { depth: 1, sort: 'manual' },
        audience: { kind: 'reader', identities: reader, seesEverything: false },
      },
    )
    expect(result).toEqual({ kind: 'pages', pages: [] })
  })

  it('reports a permission tree it cannot resolve rather than guessing', async () => {
    const broken = { ...workspace, unitId: 'missing-unit' }
    const result = await listChildPages(
      { uow },
      {
        parent: await guide(),
        workspace: broken,
        options: { depth: 1, sort: 'manual' },
        audience: { kind: 'reader', identities: reader, seesEverything: false },
      },
    )
    expect(result.kind).toBe('broken-tree')
  })
})

/** Every repository call, by name, so a test can see how many round trips an answer took. */
function counting(base: InMemoryUnitOfWork): { uow: UnitOfWork; calls: string[] } {
  const calls: string[] = []
  const wrap = <T extends object>(name: string, target: T): T =>
    new Proxy(target, {
      get(object, property, receiver) {
        const value: unknown = Reflect.get(object, property, receiver)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          calls.push(`${name}.${String(property)}`)
          return Reflect.apply(value, object, args)
        }
      },
    })
  const repos = Object.fromEntries(
    Object.entries(base.repos).map(([name, repository]) => [name, wrap(name, repository)]),
  ) as unknown as RepositoryBundle
  return { uow: { repos, run: async (fn) => fn(repos) }, calls }
}

describe('the cost of a list', () => {
  it('is a fixed number of queries however many pages there are: never one per page', async () => {
    const small = counting(uow)
    await list({ depth: 6 }, undefined, { uow: small.uow })
    for (let n = 0; n < 40; n += 1)
      await document(id(100 + n), INSTALL, `Page ${String(n)}`, 10 + n)
    const large = counting(uow)
    const pages = await list({ depth: 6 }, undefined, { uow: large.uow })
    expect(JSON.stringify(titles(pages))).toContain('Page 39')
    expect(large.calls.toSorted()).toEqual(small.calls.toSorted())
    expect(large.calls.filter((call) => call.startsWith('documents.'))).toEqual([
      'documents.listDescendants',
      'documents.listAncestors',
    ])
    expect(large.calls.filter((call) => call.startsWith('documentSummaries.'))).toEqual([
      'documentSummaries.listByIds',
    ])
  })

  it('reads the subtree once while a cache holds it, and asks permissions every time', async () => {
    const held = new Map<string, ChildPagesStructure>()
    const cache: ChildPagesCache = {
      find: (key) => held.get(key),
      remember: (key, structure) => held.set(key, structure),
    }
    const first = counting(uow)
    await list({ depth: 2 }, undefined, { uow: first.uow, childPagesCache: cache })
    expect([...held.keys()]).toEqual([childPagesKey(GUIDE, 2)])

    const second = counting(uow)
    const pages = await list({ depth: 2 }, undefined, { uow: second.uow, childPagesCache: cache })
    expect(titles(pages)).toEqual(['Upgrade', { Install: ['Linux'] }, 'Roadmap'])
    expect(second.calls.some((call) => call.startsWith('documents.'))).toBe(false)
    expect(second.calls.some((call) => call.startsWith('grants.'))).toBe(true)

    // A deny written after the subtree was cached still applies at once.
    await grant('document', INSTALL, 'deny')
    expect(titles(await list({ depth: 2 }, undefined, { uow, childPagesCache: cache }))).toEqual([
      'Upgrade',
      'Roadmap',
    ])
  })
})
