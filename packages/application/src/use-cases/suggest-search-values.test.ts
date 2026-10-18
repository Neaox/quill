import { groupId, userId, userPrincipal, workspaceId } from '@quill/domain'
import type { Principal } from '@quill/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SearchIndex } from '../ports/index.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { listVisibleWorkspaces } from './list-visible-workspaces.ts'
import { suggestSearchValues } from './suggest-search-values.ts'
import type { SuggestionField } from './suggest-search-values.ts'

/**
 * Suggestions are drawn from what the caller may already read, so the cases
 * that matter are the ones where something exists that they may not see: a
 * unit that is a sibling of theirs, a workspace they hold no grant on, and a
 * stranger who holds nothing at all.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const ENGINEERING = workspaceId('00000000-0000-4000-8000-000000000101')
const FINANCE = workspaceId('00000000-0000-4000-8000-000000000102')
const HANDBOOK = workspaceId('00000000-0000-4000-8000-000000000103')
const READER = userId('00000000-0000-4000-8000-000000000001')
const STRANGER = userId('00000000-0000-4000-8000-000000000002')

let uow: InMemoryUnitOfWork
let searchIndex: SearchIndex & { suggest: ReturnType<typeof vi.fn<SearchIndex['suggest']>> }

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  searchIndex = {
    index: vi.fn<SearchIndex['index']>(),
    remove: vi.fn<SearchIndex['remove']>(),
    search: vi.fn<SearchIndex['search']>(),
    suggest: vi.fn<SearchIndex['suggest']>().mockResolvedValue(['Ada Lovelace', 'Sam Taylor']),
    facets: vi.fn<SearchIndex['facets']>(),
  }

  for (const [id, parentId, name] of [
    ['acme', null, 'Acme'],
    ['engineering-unit', 'acme', 'Engineering'],
    ['finance-unit', 'acme', 'Finance'],
    ['secret-unit', null, 'Skunkworks'],
  ] as const) {
    await uow.repos.units.create({ id, parentId, name, slug: id, label: 'unit', now: NOW })
  }
  for (const [id, unitId, name, slug] of [
    [ENGINEERING, 'engineering-unit', 'Platform docs', 'platform-docs'],
    [FINANCE, 'finance-unit', 'Ledger', 'ledger'],
    [HANDBOOK, 'secret-unit', 'Handbook', 'handbook'],
  ] as const) {
    await uow.repos.workspaces.create({ id, unitId, name, slug, now: NOW })
  }
  for (const [id, workspace, name] of [
    ['runbooks', ENGINEERING, 'Runbooks'],
    ['guides', ENGINEERING, 'Guides'],
    ['ledgers', FINANCE, 'Ledgers'],
    ['secrets', HANDBOOK, 'Secret plans'],
  ] as const) {
    await uow.repos.collections.create({ id, workspaceId: workspace, name, slug: id, now: NOW })
  }
  for (const [number, unitId, name] of [
    [1, 'engineering-unit', 'Platform'],
    [2, 'engineering-unit', 'SRE'],
    [3, 'finance-unit', 'Accounts'],
    [4, 'acme', 'Everyone at Acme'],
    [5, 'secret-unit', 'Project X'],
  ] as const) {
    await uow.repos.groups.create({
      id: groupId(`00000000-0000-4000-8000-00000000050${number}`),
      unitId,
      parentGroupId: null,
      name,
      now: NOW,
    })
  }
  // The reader may read Engineering only.
  await uow.repos.grants.create({
    id: 'grant-1',
    principalKind: 'user',
    principalId: READER,
    scopeKind: 'workspace',
    scopeId: ENGINEERING,
    role: 'viewer',
    effect: 'allow',
    createdBy: null,
    now: NOW,
  })
})

async function suggest(
  field: SuggestionField,
  prefix = '',
  options: {
    readonly user?: typeof READER
    readonly limit?: number
    readonly seesEverything?: boolean
    readonly current?: typeof ENGINEERING
  } = {},
) {
  const identities: readonly Principal[] = [userPrincipal(options.user ?? READER)]
  const { workspaces } = await listVisibleWorkspaces(
    { uow },
    { identities, seesEverything: options.seesEverything ?? false },
  )
  return suggestSearchValues(
    { uow, searchIndex },
    {
      field,
      prefix,
      limit: options.limit ?? 8,
      identities,
      readable: workspaces,
      ...(options.current === undefined ? {} : { currentWorkspaceId: options.current }),
    },
  )
}

const values = (found: readonly { readonly value: string }[]) => found.map((item) => item.value)

describe('suggestSearchValues: status', () => {
  it('offers the fixed statuses, filtered by what was typed', async () => {
    expect(values(await suggest('status'))).toEqual(['archived', 'draft', 'published'])
    expect(values(await suggest('status', 'PUB'))).toEqual(['published'])
  })

  it('offers them even to somebody who can read nothing, because they name no one', async () => {
    expect(values(await suggest('status', 'd', { user: STRANGER }))).toEqual([
      'draft',
      'archived',
      'published',
    ])
  })
})

describe('suggestSearchValues: in', () => {
  it('offers the workspaces the caller may read and no others', async () => {
    expect(await suggest('in')).toEqual([{ value: 'Platform docs', label: 'Platform docs' }])
    expect(values(await suggest('in', 'led'))).toEqual([])
  })

  it('offers every workspace to an instance admin', async () => {
    expect(values(await suggest('in', '', { seesEverything: true }))).toEqual([
      'Handbook',
      'Ledger',
      'Platform docs',
    ])
  })

  it('offers nothing to a stranger', async () => {
    expect(await suggest('in', '', { user: STRANGER })).toEqual([])
  })
})

describe('suggestSearchValues: collection', () => {
  it('offers the collections of the workspaces the caller may read, ranked by what was typed', async () => {
    expect(values(await suggest('collection'))).toEqual(['Guides', 'Runbooks'])
    expect(values(await suggest('collection', 'ru'))).toEqual(['Runbooks'])
    expect(values(await suggest('collection', 'ide', { limit: 1 }))).toEqual(['Guides'])
  })

  it('never offers a collection of a workspace the caller cannot read', async () => {
    expect(values(await suggest('collection', 'secret'))).toEqual([])
    expect(values(await suggest('collection', 'ledger'))).toEqual([])
    expect(values(await suggest('collection', 'secret', { seesEverything: true }))).toEqual([
      'Secret plans',
    ])
  })

  it('offers nothing to a stranger', async () => {
    expect(await suggest('collection', '', { user: STRANGER })).toEqual([])
  })
})

describe('suggestSearchValues: team', () => {
  it('offers the units above the workspaces the caller reads, and the groups of those units', async () => {
    expect(values(await suggest('team'))).toEqual([
      'Acme',
      'Engineering',
      'Everyone at Acme',
      'Platform',
      'SRE',
    ])
  })

  it('does not offer a unit private to the caller, or its groups, however it is spelt', async () => {
    for (const hidden of ['finance', 'accounts', 'skunk', 'project x']) {
      expect(values(await suggest('team', hidden))).toEqual([])
    }
  })

  it('offers every unit a workspace hangs off to an instance admin', async () => {
    const names = values(await suggest('team', '', { seesEverything: true, limit: 20 }))
    expect(names).toContain('Finance')
    expect(names).toContain('Skunkworks')
    expect(names).toContain('Project X')
  })

  it('reveals nothing of how the organisation is built to a stranger', async () => {
    expect(await suggest('team', '', { user: STRANGER })).toEqual([])
  })
})

describe('suggestSearchValues: by and tag', () => {
  it("asks the index with the caller's workspaces and principals, so it filters by permission itself", async () => {
    const found = await suggest('by', 'a', { limit: 5, current: ENGINEERING })

    expect(found).toEqual([
      { value: 'Ada Lovelace', label: 'Ada Lovelace' },
      { value: 'Sam Taylor', label: 'Sam Taylor' },
    ])
    expect(searchIndex.suggest).toHaveBeenCalledExactlyOnceWith(
      { field: 'by', prefix: 'a', limit: 5, currentWorkspaceId: ENGINEERING },
      { workspaceIds: [ENGINEERING], principalKeys: [`user:${READER}`] },
    )
  })

  it('does not name a current workspace unless it was given one', async () => {
    await suggest('tag')
    expect(searchIndex.suggest.mock.calls[0]?.[0]).toEqual({ field: 'tag', prefix: '', limit: 8 })
  })

  it('does not ask the index at all when the caller can read nothing', async () => {
    expect(await suggest('by', '', { user: STRANGER })).toEqual([])
    expect(await suggest('tag', '', { user: STRANGER })).toEqual([])
    expect(searchIndex.suggest).not.toHaveBeenCalled()
  })
})
