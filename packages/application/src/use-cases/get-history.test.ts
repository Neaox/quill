import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, revisionId, workspaceId } from '@quill/domain'

import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { getHistory, MAX_HISTORY_LIMIT } from './get-history.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const DOC = documentId('00000000-0000-4000-8000-000000000201')

let uow: InMemoryUnitOfWork

async function append(index: number, changeNote: string | null): Promise<void> {
  await uow.repos.revisions.append({
    id: `revision-${index}`,
    documentId: DOC,
    workspaceId: WORKSPACE,
    revision: revisionId(index.toString(16).padStart(40, '0')),
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
    timestamp: new Date(NOW.getTime() + index * 1000),
    summary: `Revision ${index}`,
    changeNote,
    now: NOW,
  })
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  for (let index = 0; index < 5; index++) await append(index, index === 0 ? null : `note ${index}`)
})

describe('getHistory', () => {
  it('returns the newest revisions first with the author and the change note', async () => {
    const page = await getHistory({ uow }, { documentId: DOC })
    expect(page.revisions.map((entry) => entry.summary)).toEqual([
      'Revision 4',
      'Revision 3',
      'Revision 2',
      'Revision 1',
      'Revision 0',
    ])
    expect(page.revisions[0]).toMatchObject({
      author: { name: 'Ada', email: 'ada@example.com' },
      changeNote: 'note 4',
    })
    expect(page.revisions.at(-1)).not.toHaveProperty('changeNote')
    expect(page.nextCursor).toBeUndefined()
  })

  it('pages with a cursor and stops offering one at the end', async () => {
    const first = await getHistory({ uow }, { documentId: DOC, limit: 2 })
    expect(first.revisions).toHaveLength(2)
    expect(first.nextCursor).toBe('revision-3')

    const second = await getHistory(
      { uow },
      { documentId: DOC, limit: 2, cursor: first.nextCursor },
    )
    expect(second.revisions.map((entry) => entry.summary)).toEqual(['Revision 2', 'Revision 1'])

    const last = await getHistory({ uow }, { documentId: DOC, limit: 2, cursor: second.nextCursor })
    expect(last.revisions.map((entry) => entry.summary)).toEqual(['Revision 0'])
    expect(last.nextCursor).toBeUndefined()
  })

  it('caps the page size, because history without a limit is a walk of everything', async () => {
    const asked: number[] = []
    const counting = {
      uow: {
        ...uow,
        repos: {
          ...uow.repos,
          revisions: {
            ...uow.repos.revisions,
            listForDocument: async (id: typeof DOC, page: { limit: number }) => {
              asked.push(page.limit)
              return uow.repos.revisions.listForDocument(id, page)
            },
          },
        },
      },
    }
    await getHistory(counting, { documentId: DOC, limit: 10_000 })
    expect(asked).toEqual([MAX_HISTORY_LIMIT + 1])
  })
})
