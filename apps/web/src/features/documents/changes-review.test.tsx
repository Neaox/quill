import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { jsonResponse } from '../../lib/api/testing.ts'
import { ChangesReview, type ChangesReviewProps } from './changes-review.tsx'

const COMPARISON = {
  html: '',
  summary: {
    sections: 1,
    added: 1,
    removed: 0,
    changed: 1,
    moved: 1,
    wordsAdded: 6,
    wordsRemoved: 1,
  },
  changes: [
    {
      id: 'c1',
      change: 'changed',
      block: 'paragraph',
      excerpt: 'Restart the queue first, then wait.',
      wordsAdded: 2,
      wordsRemoved: 0,
      section: { id: 'steps', title: 'Steps' },
      revertible: true,
      author: { id: 'grace', name: 'Grace Hopper', at: new Date().toISOString() },
      html: '<article><p data-change="changed">Restart the queue first<ins data-diff="added"><span data-diff-label="">Added: </span>, then wait</ins>.</p></article>',
    },
    {
      id: 'c2',
      change: 'added',
      block: 'paragraph',
      excerpt: 'Page the manager.',
      wordsAdded: 3,
      wordsRemoved: 0,
      revertible: true,
      html: '<article><p data-change="added"><ins data-diff="added">Page the manager.</ins></p></article>',
    },
    {
      id: 'c3',
      change: 'moved',
      block: 'paragraph',
      excerpt: 'Check the dashboard.',
      wordsAdded: 0,
      wordsRemoved: 0,
      revertible: false,
      html: '<article><p data-change="moved">Check the dashboard.</p></article>',
    },
  ],
  sections: [],
  properties: [],
}

function open(props: Partial<ChangesReviewProps> = {}, body: unknown = COMPARISON) {
  const run = vi.fn<(changes: readonly string[]) => Promise<void>>(() => Promise.resolve())
  const onOpenChange = vi.fn<(open: boolean) => void>()
  render(
    <ChangesReview
      documentId="doc-1"
      published={'a'.repeat(40)}
      saved={3}
      open
      onOpenChange={onOpenChange}
      revert={{ allowed: true, run }}
      {...props}
    />,
    {
      wrapper: createHookWrapper({
        'GET /api/documents/{id}/compare': () => jsonResponse(200, body),
      }),
    },
  )
  return { run, onOpenChange }
}

const list = async () => await screen.findByRole('list', { name: 'Changes' })

describe('the changes review', () => {
  it('lists every change since the page was published, with where each is', async () => {
    open()

    const rows = within(await list()).getAllByRole('listitem')

    expect(rows).toHaveLength(3)
    expect(within(rows[0] as HTMLElement).getByText('Steps')).toBeVisible()
    expect(within(rows[1] as HTMLElement).getByText('The start')).toBeVisible()
    expect(
      screen.getByText('1 block added, 1 block changed, 1 block moved · +6 words, −1 word'),
    ).toBeVisible()
  })

  it('says who made a change and how long ago, when that is known', async () => {
    open()

    const rows = within(await list()).getAllByRole('listitem')

    expect(within(rows[0] as HTMLElement).getByText(/Grace Hopper/u)).toBeVisible()
    expect(within(rows[0] as HTMLElement).getByText('just now')).toBeVisible()
    expect(within(rows[1] as HTMLElement).queryByText(/Grace Hopper/u)).toBeNull()
  })

  it('shows the published words beside the draft’s for the change it opens on', async () => {
    open({ initial: 'c2' })
    await list()

    expect(screen.getByRole('region', { name: 'Published' })).toHaveTextContent(
      'Not in the published page.',
    )
    expect(screen.getByRole('region', { name: 'Your draft' })).toHaveTextContent(
      'Page the manager.',
    )
  })

  it('shows another change when it is chosen', async () => {
    open()
    await userEvent.click(await screen.findByRole('button', { name: /Page the manager/u }))

    expect(screen.getByRole('region', { name: 'Your draft' })).toHaveTextContent(
      'Page the manager.',
    )
    expect(
      within(await list())
        .getByText('Page the manager.')
        .closest('li'),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('puts back the change that is open', async () => {
    const { run } = open()
    await list()

    await userEvent.click(screen.getByRole('button', { name: 'Put this back' }))

    expect(run).toHaveBeenCalledWith(['c1'])
  })

  it('puts back the ones that were picked, and only those', async () => {
    const { run } = open()
    await list()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select: Page the manager.' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Select: Restart the queue/u }))
    await userEvent.click(screen.getByRole('button', { name: 'Put back 2 selected' }))

    expect(run).toHaveBeenCalledWith(['c2', 'c1'])
  })

  it('cannot pick, or put back, what cannot be put back, and says so', async () => {
    open()
    await userEvent.click(await screen.findByRole('button', { name: /Check the dashboard/u }))

    expect(screen.getByRole('checkbox', { name: 'Select: Check the dashboard.' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Put this back' })).toBeDisabled()
    expect(screen.getByText(/A move cannot be put back from here/u)).toBeVisible()
  })

  it('puts nothing back, and says why, when that is not allowed now', async () => {
    const run = vi.fn<(changes: readonly string[]) => Promise<void>>()
    open({
      revert: { allowed: false, reason: 'Your latest edits are still being saved.', run },
    })
    await list()

    expect(screen.getByRole('button', { name: 'Put this back' })).toBeDisabled()
    expect(screen.getByText('Your latest edits are still being saved.')).toBeVisible()
    expect(run).not.toHaveBeenCalled()
  })

  it('starts again once changes are put back, because its ids no longer mean what they did', async () => {
    open()
    await userEvent.click(
      await screen.findByRole('checkbox', { name: /Select: Restart the queue/u }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Put back 1 selected' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Put back selected' })).toBeDisabled()
    })
  })

  it('goes from one change to the next and back, and says where it is', async () => {
    open()
    await list()
    expect(screen.getByText('Change 1 of 3')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Change 2 of 3')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Your draft' })).toHaveTextContent(
      'Page the manager.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByText('Change 1 of 3')).toBeVisible()
  })

  it('moves between changes with the arrow keys, keeping the focus on the one that is open', async () => {
    open()
    const first = await screen.findByRole('button', { name: /Restart the queue first/u })
    first.focus()

    await userEvent.keyboard('{ArrowDown}')

    const second = screen.getByRole('button', { name: /Page the manager/u })
    expect(second).toHaveFocus()
    expect(screen.getByRole('region', { name: 'Your draft' })).toHaveTextContent(
      'Page the manager.',
    )
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('button', { name: /Check the dashboard/u })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(first).toHaveFocus()
  })

  it('selects every change that can be put back, and clears them again', async () => {
    open()
    await list()

    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))

    expect(screen.getByRole('button', { name: 'Put back 2 selected' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Select: Check the dashboard.' })).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('button', { name: 'Put back selected' })).toBeDisabled()
  })

  it('says why a block that is not a move cannot be put back', async () => {
    const [, , , ...rest] = COMPARISON.changes
    const drifted = {
      ...COMPARISON,
      changes: [{ ...COMPARISON.changes[0], revertible: false }, ...rest],
    }
    open({}, drifted)
    await list()

    expect(screen.getByText(/written differently in your draft/u)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Put this back' })).toBeDisabled()
  })

  it('has no accessibility violations', async () => {
    open()
    await list()

    await expectNoAccessibilityViolations(screen.getByRole('dialog'))
  })
})
