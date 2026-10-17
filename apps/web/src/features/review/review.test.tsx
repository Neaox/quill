import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { ReviewActions } from './review-actions.tsx'

const DOCUMENT = 'doc-1'

const person = (id: string, name: string) => ({
  id,
  name,
  email: `${name.toLowerCase()}@example.com`,
  canView: true,
})

const CANDIDATES = {
  people: [person('u-ada', 'Ada'), person('u-grace', 'Grace')],
  groups: [{ id: 'g-platform', name: 'Platform team', memberCount: 12, canView: true }],
}

const review = (overrides: Record<string, unknown> = {}) => ({
  id: 'review-1',
  documentId: DOCUMENT,
  status: 'open',
  requestedBy: { id: 'u-me', name: 'Me' },
  message: 'Please check the rollback section.',
  createdAt: '2026-10-13T08:00:00.000Z',
  draftVersion: 4,
  stale: false,
  canDecide: false,
  canWithdraw: true,
  assignments: [
    {
      id: 'a1',
      reviewer: { kind: 'user', id: 'u-ada', name: 'Ada' },
      state: 'approved',
      decidedBy: { id: 'u-ada', name: 'Ada' },
      comment: 'Looks right.',
      decidedAt: '2026-10-13T09:00:00.000Z',
    },
    {
      id: 'a2',
      reviewer: { kind: 'group', id: 'g-platform', name: 'Platform team', memberCount: 12 },
      state: 'pending',
      decidedBy: null,
      comment: null,
      decidedAt: null,
    },
  ],
  ...overrides,
})

function mount(routes: FakeRoutes, props: Partial<Parameters<typeof ReviewActions>[0]> = {}) {
  const Wrapper = createHookWrapper({
    'GET /api/documents/{id}/reviewer-candidates': () => jsonResponse(200, CANDIDATES),
    ...routes,
  })
  return render(
    <Wrapper>
      <ReviewActions
        documentId={DOCUMENT}
        title="Regional failover"
        canEdit
        canPublish
        published={'b'.repeat(40)}
        {...props}
      />
    </Wrapper>,
  )
}

const none = { 'GET /api/documents/{id}/review': () => jsonResponse(200, { request: null }) }

describe('requesting a review', () => {
  it('asks the people and groups chosen, with a message, and says it has', async () => {
    const sent: unknown[] = []
    mount({
      ...none,
      'POST /api/documents/{id}/review': async (request) => {
        sent.push(await request.json())
        return jsonResponse(201, review())
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Request review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Request a review' })

    // Nothing can be sent until somebody is chosen, and the dialog says why.
    expect(
      within(dialog).getByText('Choose at least one person or group to ask.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Request review' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    const field = within(dialog).getByRole('combobox', { name: 'Reviewers' })
    await userEvent.click(field)
    await userEvent.click(await screen.findByRole('option', { name: 'Platform team' }))
    // The popup closes on a choice; the arrow key opens it again.
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.click(await screen.findByRole('option', { name: 'Ada' }))

    const chosen = within(dialog).getByRole('list', { name: 'Chosen reviewers' })
    expect(within(chosen).getAllByRole('listitem')).toHaveLength(2)
    expect(within(chosen).getByText(/group · 12 people/u)).toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText('Message (optional)'), 'Mind the rollback')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request review' }))

    await waitFor(() => {
      expect(sent).toEqual([
        {
          reviewers: [
            { kind: 'group', id: 'g-platform' },
            { kind: 'user', id: 'u-ada' },
          ],
          message: 'Mind the rollback',
        },
      ])
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Request a review' })).not.toBeInTheDocument()
    })
  })

  it('lets a chosen reviewer be taken back out, and no longer offers them', async () => {
    mount(none)

    await userEvent.click(await screen.findByRole('button', { name: 'Request review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Request a review' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Reviewers' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Ada' }))

    expect(screen.queryByRole('option', { name: 'Ada' })).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Ada' }))
    expect(within(dialog).queryByRole('list', { name: 'Chosen reviewers' })).not.toBeInTheDocument()
  })

  it('says what the server refused', async () => {
    mount({
      ...none,
      'POST /api/documents/{id}/review': () =>
        errorResponse(422, 'reviewer_cannot_view', 'Grace cannot see this document'),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Request review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Request a review' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Reviewers' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Grace' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request review' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Grace cannot see/u)
  })

  it('is not offered to somebody who cannot write, nor while a request is already open', async () => {
    const first = mount(none, { canEdit: false })
    await screen.findByRole('button', { name: /Request review/u }).then(
      () => {
        throw new Error('offered to a reader')
      },
      () => undefined,
    )
    first.unmount()

    mount({ 'GET /api/documents/{id}/review': () => jsonResponse(200, { request: review() }) })
    expect(await screen.findByRole('button', { name: /^Review: In review/u })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request review' })).not.toBeInTheDocument()
  })

  it('stays accessible', async () => {
    mount(none)
    await userEvent.click(await screen.findByRole('button', { name: 'Request review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Request a review' })

    await expectNoAccessibilityViolations(dialog)
  })
})

describe('an open review', () => {
  it('shows who has answered and who has not', async () => {
    mount({ 'GET /api/documents/{id}/review': () => jsonResponse(200, { request: review() }) })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Review: In review · 1 of 2 approved' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Review' })

    expect(within(dialog).getByText('Please check the rollback section.')).toBeInTheDocument()
    const rows = within(within(dialog).getByRole('list', { name: 'Reviewers' })).getAllByRole(
      'listitem',
    )
    expect(rows[0]).toHaveTextContent('Ada')
    expect(rows[0]).toHaveTextContent('Approved')
    expect(rows[0]).toHaveTextContent('Looks right.')
    expect(rows[1]).toHaveTextContent('Platform team')
    expect(rows[1]).toHaveTextContent('Waiting')
    expect(rows[1]).toHaveTextContent('Any one member can answer')
    // Not addressed to this person, so there is nothing to answer.
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    await expectNoAccessibilityViolations(dialog)
  })

  it('warns that the draft has changed since it was asked', async () => {
    mount({
      'GET /api/documents/{id}/review': () =>
        jsonResponse(200, { request: review({ stale: true }) }),
    })

    await userEvent.click(await screen.findByRole('button', { name: /^Review: .*changed since/u }))

    expect(
      await screen.findByText('The draft has changed since this was requested'),
    ).toBeInTheDocument()
  })

  it('lets a reviewer approve, or ask for changes, with a comment', async () => {
    const answers: unknown[] = []
    mount(
      {
        'GET /api/documents/{id}/review': () =>
          jsonResponse(200, { request: review({ canDecide: true, canWithdraw: false }) }),
        'POST /api/documents/{id}/review/decision': async (request) => {
          answers.push(await request.json())
          return jsonResponse(200, review({ canDecide: false, status: 'approved' }))
        },
      },
      { canEdit: false },
    )

    await userEvent.click(await screen.findByRole('button', { name: /^Review: / }))
    const dialog = await screen.findByRole('dialog', { name: 'Review' })
    await userEvent.type(within(dialog).getByLabelText('Your comment (optional)'), 'Ship it')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(answers).toEqual([{ decision: 'approve', comment: 'Ship it' }])
    })
    // The answer comes back and the request is shown as it now stands, under the dialog.
    expect(
      await screen.findByRole('button', { name: 'Review: Approved', hidden: true }),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('lets the one who asked take the request back', async () => {
    let withdrawn = 0
    mount({
      'GET /api/documents/{id}/review': () => jsonResponse(200, { request: review() }),
      'DELETE /api/documents/{id}/review': () => {
        withdrawn += 1
        return new Response(undefined, { status: 204 })
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: /^Review: / }))
    const dialog = await screen.findByRole('dialog', { name: 'Review' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw request' }))

    await waitFor(() => {
      expect(withdrawn).toBe(1)
    })
  })
})
