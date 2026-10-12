import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { jsonResponse } from '../../lib/api/testing.ts'
import { DraftPreviewLink } from './draft-preview-link.tsx'

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
  summary: { ...NONE.summary, sections: 1, changed: 1, wordsAdded: 4, wordsRemoved: 1 },
  changes: [
    {
      id: 'c1',
      change: 'changed',
      block: 'paragraph',
      excerpt: 'Restart the queue first.',
      wordsAdded: 4,
      wordsRemoved: 1,
      section: { id: 'steps', title: 'Steps' },
    },
  ],
}

function open(body: unknown) {
  return render(
    <DraftPreviewLink
      documentId="doc-1"
      published={'a'.repeat(40)}
      saved={3}
      unsaved={false}
      beforeOpen={() => Promise.resolve()}
    />,
    {
      wrapper: createHookWrapper({
        'GET /api/documents/{id}/compare': () => jsonResponse(200, body),
      }),
    },
  )
}

const link = (): HTMLElement => screen.getByRole('link', { name: /Preview/u })

describe('the draft preview link', () => {
  it('shows what the preview has that the published page does not, when the pointer rests on it', async () => {
    open(SOME)
    await waitFor(() => {
      expect(link()).toHaveAccessibleDescription(/1 block changed/u)
    })

    await userEvent.hover(link())

    const card = (await screen.findByText('What the preview shows')).parentElement as HTMLElement
    expect(within(card).getByText('1 block changed · +4 words, −1 word')).toBeVisible()
    expect(within(card).getByText('Restart the queue first.')).toBeVisible()
  })

  it('says so when the draft is what is published', async () => {
    open(NONE)
    await waitFor(() => {
      expect(link()).toHaveAccessibleDescription(/No unpublished changes/u)
    })

    await userEvent.hover(link())

    expect(
      await screen.findAllByText(
        'No unpublished changes, so the preview matches the published page.',
      ),
    ).not.toHaveLength(0)
  })

  it('still goes to the draft preview, and is not disabled by there being nothing', async () => {
    open(NONE)

    expect(link()).toHaveAttribute('href', '/preview/d/doc-1?draft')
    expect(link()).not.toHaveAttribute('aria-disabled')
  })

  it('has no accessibility violations', async () => {
    const { container } = open(SOME)
    await waitFor(() => {
      expect(link()).toHaveAccessibleDescription(/1 block changed/u)
    })

    await expectNoAccessibilityViolations(container)
  })
})
