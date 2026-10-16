import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'

import { createFakeClock } from '../test-support/fakes.ts'
import type { FakeClock } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import {
  clearDocumentHistory,
  HISTORY_RETENTION_MS,
  recordDocumentView,
  sweepDocumentViews,
  VIEW_DEBOUNCE_MS,
} from './document-views.ts'

const START = new Date('2026-10-13T12:00:00.000Z')
const ADA = userId('00000000-0000-4000-8000-000000000001')
const GRACE = userId('00000000-0000-4000-8000-000000000002')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER_WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000102')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const OTHER_DOC = documentId('00000000-0000-4000-8000-000000000202')

let uow: InMemoryUnitOfWork
let clock: FakeClock

const view = (user = ADA, document = DOC, workspace = WORKSPACE) =>
  recordDocumentView({ uow, clock }, { userId: user, documentId: document, workspaceId: workspace })

const recent = (user = ADA) =>
  uow.repos.documentViews.listRecent({ userId: user, since: new Date(0), limit: 50 })

beforeEach(() => {
  uow = createInMemoryUnitOfWork()
  clock = createFakeClock(START)
})

describe('recordDocumentView', () => {
  it('records the first open', async () => {
    expect(await view()).toBe(true)
    expect(await recent()).toEqual([
      { userId: ADA, documentId: DOC, workspaceId: WORKSPACE, lastViewedAt: START, views: 1 },
    ])
  })

  it('does nothing for a second open inside the debounce window', async () => {
    await view()
    clock.advance(VIEW_DEBOUNCE_MS - 1)

    expect(await view()).toBe(false)
    expect(await recent()).toMatchObject([{ lastViewedAt: START, views: 1 }])
  })

  it('counts the next open once the window has passed', async () => {
    await view()
    clock.advance(VIEW_DEBOUNCE_MS + 1)

    expect(await view()).toBe(true)
    expect(await recent()).toMatchObject([
      { lastViewedAt: new Date(START.getTime() + VIEW_DEBOUNCE_MS + 1), views: 2 },
    ])
  })

  it('keeps each person’s record separate', async () => {
    await view(ADA)
    await view(GRACE)

    expect(await recent(ADA)).toHaveLength(1)
    expect(await recent(GRACE)).toHaveLength(1)
  })
})

describe('clearDocumentHistory', () => {
  it('forgets everything one person opened and nothing of anybody else’s', async () => {
    await view(ADA, DOC)
    await view(ADA, OTHER_DOC, OTHER_WORKSPACE)
    await view(GRACE, DOC)

    expect(await clearDocumentHistory({ uow }, ADA)).toBe(2)
    expect(await recent(ADA)).toEqual([])
    expect(await recent(GRACE)).toHaveLength(1)
  })
})

describe('sweepDocumentViews', () => {
  it('removes views older than ninety days, for everybody, and keeps the rest', async () => {
    await view(ADA, DOC)
    await view(GRACE, OTHER_DOC, OTHER_WORKSPACE)
    clock.advance(HISTORY_RETENTION_MS - 1_000)
    await view(GRACE, DOC)
    clock.advance(2_000)

    // Ada's one view and Grace's first are now past the window; Grace's second is not.
    expect(await sweepDocumentViews({ uow }, clock.now())).toBe(2)
    expect(await recent(ADA)).toEqual([])
    expect(await recent(GRACE)).toMatchObject([{ documentId: DOC }])
  })
})
