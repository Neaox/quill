import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { jsonResponse } from '../../lib/api/testing.ts'
import { ReviewButton } from './review-button.tsx'

const NONE = {
  html: '',
  summary: {
    sections: 0,
    added: 0,
    removed: 0,
    changed: 0,
    moved: 0,
    wordsAdded: 0,
    wordsRemoved: 0,
  },
  changes: [],
  sections: [],
  properties: [],
}

const SOME = {
  ...NONE,
  summary: { ...NONE.summary, sections: 1, changed: 1 },
  changes: [
    {
      id: 'c1',
      change: 'changed',
      block: 'paragraph',
      excerpt: 'Edited.',
      wordsAdded: 1,
      wordsRemoved: 0,
    },
  ],
}

function open(body: unknown) {
  const onReview = vi.fn<() => void>()
  render(
    <ReviewButton
      documentId="doc-1"
      published={null}
      saved={1}
      unsaved={false}
      onReview={onReview}
    />,
    {
      wrapper: createHookWrapper({
        'GET /api/documents/{id}/compare': () => jsonResponse(200, body),
      }),
    },
  )
  return onReview
}

describe('the review button', () => {
  it('opens the review when there is something to review', async () => {
    const onReview = open(SOME)

    await userEvent.click(await screen.findByRole('button', { name: 'Review changes' }))

    expect(onReview).toHaveBeenCalledTimes(1)
  })

  it('is not there when nothing has changed, nor while that is not known', async () => {
    open(NONE)

    await waitFor(() => {
      expect(screen.queryByRole('button')).toBeNull()
    })
  })
})
