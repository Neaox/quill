import { beforeEach, describe, expect, it } from 'vitest'
import { userId, workspaceId } from '@quill/domain'

import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import { createFakeDocumentFormat, serialise } from '../test-support/fake-document-format.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { DocumentRow } from '../ports/persistence.ts'
import {
  factsOf,
  namePeople,
  PEOPLE_SEARCH_LIMIT,
  readPublicFacts,
  searchPeople,
} from './document-facts.ts'

const NOW = new Date('2026-03-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')

let uow: InMemoryUnitOfWork

async function person(n: number, email: string, displayName: string, verified = true) {
  const id = userId(`00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`)
  await uow.repos.users.create({ id, email, displayName, now: NOW })
  if (verified) await uow.repos.users.markEmailVerified(id, NOW)
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  await person(1, 'ada@example.com', 'Ada Lovelace')
  await person(2, 'grace@example.com', 'Grace Hopper')
  await person(3, 'mallory@example.com', 'Definitely The CEO', false)
})

describe('the facts a reader is shown', () => {
  it('names the owners who are people, and keeps everything else as written', async () => {
    const facts = await factsOf(
      { uow },
      {
        status: 'draft',
        owners: ['ADA@example.com', 'platform', 'mallory@example.com'],
        tags: ['ops'],
        review: { interval: '6m', lastReviewed: '2026-01-02' },
      },
    )
    expect(facts).toEqual({
      status: 'draft',
      lifecycle: undefined,
      type: undefined,
      owners: [
        { label: 'Ada Lovelace', person: true },
        { label: 'platform', person: false },
        // Not a verified address, so not a person anyone can vouch for: the
        // value stays as the author wrote it, never the name its holder chose.
        { label: 'mallory@example.com', person: false },
      ],
      tags: ['ops'],
      reviewInterval: '6m',
      lastReviewed: '2026-01-02',
    })
  })

  it('asks nothing of the directory for a document with no owners', async () => {
    expect((await factsOf({ uow }, {})).owners).toEqual([])
  })

  it('names who verified it as a person, in the same lookup as the owners', async () => {
    let lookups = 0
    const findVerifiedByEmails = uow.repos.users.findVerifiedByEmails.bind(uow.repos.users)
    uow.repos.users.findVerifiedByEmails = async (emails) => {
      lookups += 1
      return findVerifiedByEmails(emails)
    }
    const facts = await factsOf(
      { uow },
      {
        owners: ['ada@example.com'],
        status: 'verified',
        verified: { by: 'grace@example.com', at: '2026-02-20' },
      },
    )
    expect(facts.lifecycle).toEqual({
      state: 'verified',
      verifiedBy: { label: 'Grace Hopper', person: true },
      verifiedAt: '2026-02-20',
    })
    expect(lookups).toBe(1)
  })

  it('keeps a verifier who is not a verified person as written, and says nothing of one never written', async () => {
    expect(
      (await factsOf({ uow }, { status: 'verified', verified: { by: 'mallory@example.com' } }))
        .lifecycle,
    ).toEqual({
      state: 'verified',
      verifiedBy: { label: 'mallory@example.com', person: false },
      verifiedAt: undefined,
    })
    expect((await factsOf({ uow }, { status: 'verified' })).lifecycle).toEqual({
      state: 'verified',
      verifiedBy: undefined,
      verifiedAt: undefined,
    })
  })

  it('passes a deprecated document’s replacement on as the reference it is', async () => {
    expect(
      (await factsOf({ uow }, { status: 'deprecated', supersededBy: 'doc-2' })).lifecycle,
    ).toEqual({ state: 'deprecated', supersededBy: 'doc-2' })
  })
})

describe('the people directory', () => {
  it('finds verified people by name or address, a few at a time, by name', async () => {
    expect(await searchPeople({ uow }, 'example')).toEqual([
      { value: 'ada@example.com', name: 'Ada Lovelace', detail: 'ada@example.com' },
      { value: 'grace@example.com', name: 'Grace Hopper', detail: 'grace@example.com' },
    ])
    expect((await searchPeople({ uow }, 'HOP')).map((found) => found.name)).toEqual([
      'Grace Hopper',
    ])
    expect(await searchPeople({ uow }, 'ceo')).toEqual([])
    expect(await searchPeople({ uow }, '   ')).toEqual([])
    expect(PEOPLE_SEARCH_LIMIT).toBeGreaterThan(0)
  })

  it('names many addresses in one go, ignoring case and anyone unverified', async () => {
    expect(
      await namePeople({ uow }, ['Grace@Example.com', 'nobody@example.com', 'mallory@example.com']),
    ).toEqual([{ value: 'Grace@Example.com', name: 'Grace Hopper', detail: 'grace@example.com' }])
    expect(await namePeople({ uow }, [])).toEqual([])
  })
})

describe('what an outsider is shown', () => {
  it('reads the published front matter down to its public facts', async () => {
    const contentStore = createFakeContentStore()
    const deps = { uow, contentStore, format: createFakeDocumentFormat() }
    const document = { id: 'doc-1', workspaceId: WORKSPACE } as unknown as DocumentRow
    expect(await readPublicFacts(deps, document, NOW)).toBeNull()

    await contentStore.publish({
      workspaceId: WORKSPACE,
      author: { name: 'Ada', email: 'ada@example.com' },
      base: null,
      changes: [
        {
          kind: 'write',
          documentId: document.id,
          path: 'overview.md',
          markdown: serialise(
            {
              id: document.id,
              status: 'verified',
              verified: { by: 'ada@example.com', at: '2026-02-20' },
              owners: ['ada@example.com'],
              tags: ['ops'],
            },
            '# Overview',
          ),
        },
      ],
    })
    expect(await readPublicFacts(deps, document, NOW)).toEqual({
      status: undefined,
      lifecycle: { state: 'verified', verifiedAt: '2026-02-20' },
      tags: ['ops'],
      lastReviewed: undefined,
    })
  })
})
