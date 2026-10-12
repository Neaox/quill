import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { PublishButton } from './publish-button.tsx'

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
  summary: { ...NONE.summary, sections: 1, changed: 1, added: 1, wordsAdded: 42, wordsRemoved: 5 },
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
    {
      id: 'c2',
      change: 'added',
      block: 'paragraph',
      excerpt: 'Tell the on-call engineer.',
      wordsAdded: 38,
      wordsRemoved: 4,
    },
  ],
}

const ME = {
  id: 'me',
  email: 'ada@example.com',
  displayName: 'Ada',
  emailVerified: true,
  isInstanceAdmin: false,
}

function routes(body: unknown, asked: string[] = []): FakeRoutes {
  return {
    'GET /api/me': () => jsonResponse(200, ME),
    'GET /api/documents/{id}/compare': (request) => {
      const { searchParams } = new URL(request.url)
      asked.push(`${searchParams.get('from') ?? ''} ${searchParams.get('to') ?? ''}`)
      return jsonResponse(200, body)
    },
  }
}

function open(
  body: unknown,
  props: Partial<Parameters<typeof PublishButton>[0]> = {},
  asked: string[] = [],
) {
  const onPublish = vi.fn<() => void>()
  const result = render(
    <PublishButton
      documentId="doc-1"
      published={'a'.repeat(40)}
      saved={3}
      unsaved={false}
      loading={false}
      blocked={false}
      onPublish={onPublish}
      {...props}
    />,
    { wrapper: createHookWrapper(routes(body, asked)) },
  )
  return { onPublish, ...result }
}

const button = (): HTMLElement => screen.getByRole('button', { name: 'Publish' })

const by = (id: string, name: string) => ({ id, name, at: '2026-01-02T10:00:00.000Z' })

describe('the Publish button', () => {
  it('asks what the draft says against what is published, as of the version saved', async () => {
    const asked: string[] = []
    open(SOME, {}, asked)

    await waitFor(() => {
      expect(asked).toEqual([`${'a'.repeat(40)} draft`])
    })
  })

  it('publishes when there is something to publish', async () => {
    const { onPublish } = open(SOME)
    await waitFor(() => {
      expect(button()).toHaveAccessibleDescription(/1 block added, 1 block changed/u)
    })

    await userEvent.click(button())

    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it('is not pressable, and says why, when nothing differs from what is published', async () => {
    const { onPublish } = open(NONE)
    await waitFor(() => {
      expect(button()).toHaveAttribute('aria-disabled', 'true')
    })

    await userEvent.click(button())

    expect(onPublish).not.toHaveBeenCalled()
    expect(button()).toHaveAccessibleDescription('No changes since this was last published.')
    // Still a button, in its place and focusable, so the reason can be reached.
    expect(button()).not.toBeDisabled()
  })

  it('is not held back while it does not yet know, because a slow answer is no reason to refuse', async () => {
    const { onPublish } = open(SOME)

    await userEvent.click(button())

    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it('is not held back by edits that are still being saved, which the comparison cannot yet have seen', async () => {
    const { onPublish } = open(NONE, { unsaved: true })
    await waitFor(() => {
      expect(button()).toHaveAccessibleDescription(/still being saved/u)
    })

    await userEvent.click(button())

    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it('shows what is waiting when the pointer rests on it, listing where and what', async () => {
    open(SOME)
    await waitFor(() => {
      expect(button()).toHaveAccessibleDescription(/changed/u)
    })

    await userEvent.hover(button())

    const panel = await screen.findByText('Changes to publish')
    const card = panel.parentElement as HTMLElement
    expect(
      within(card).getByText('1 block added, 1 block changed · +42 words, −5 words'),
    ).toBeVisible()
    expect(within(card).getByText(/Steps/u)).toBeVisible()
    expect(within(card).getByText('Restart the queue first.')).toBeVisible()
  })

  it('opens the review at the change that is pressed in its panel', async () => {
    const onReview = vi.fn<(change?: string) => void>()
    open(SOME, { onReview })
    await waitFor(() => {
      expect(button()).toHaveAccessibleDescription(/changed/u)
    })

    await userEvent.hover(button())
    await userEvent.click(await screen.findByRole('button', { name: /Restart the queue first/u }))

    expect(onReview).toHaveBeenCalledWith('c1')
  })

  describe('when someone else wrote part of what would go out', () => {
    const SHARED = {
      ...SOME,
      changes: SOME.changes.map((each, index) => ({
        ...each,
        author: index === 0 ? by('me', 'Ada') : by('grace', 'Grace'),
      })),
    }

    async function pressPublish(props: Partial<Parameters<typeof PublishButton>[0]> = {}) {
      const opened = open(SHARED, props)
      await waitFor(() => {
        expect(button()).toHaveAccessibleDescription(/by Grace/u)
      })
      // The identity the warning compares with arrives alongside.
      await new Promise((resolve) => setTimeout(resolve, 50))
      await userEvent.click(button())
      return opened
    }

    it('asks first, naming who and how much, before it publishes', async () => {
      const { onPublish } = await pressPublish()

      const dialog = await screen.findByRole('dialog', { name: 'Publish changes made by others?' })
      expect(within(dialog).getByText('The draft includes 1 change by Grace.')).toBeVisible()
      expect(onPublish).not.toHaveBeenCalled()
    })

    it('publishes when it is confirmed', async () => {
      const { onPublish } = await pressPublish()

      await userEvent.click(await screen.findByRole('button', { name: 'Publish anyway' }))

      expect(onPublish).toHaveBeenCalledTimes(1)
    })

    it('offers the review instead, and publishes nothing', async () => {
      const onReview = vi.fn<(change?: string) => void>()
      const { onPublish } = await pressPublish({ onReview })

      await userEvent.click(await screen.findByRole('button', { name: 'Review changes' }))

      expect(onReview).toHaveBeenCalledTimes(1)
      expect(onPublish).not.toHaveBeenCalled()
    })

    it('publishes nothing when it is cancelled', async () => {
      const { onPublish } = await pressPublish()

      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

      expect(onPublish).not.toHaveBeenCalled()
    })
  })

  it('does not ask when every change is the writer’s own', async () => {
    const own = {
      ...SOME,
      changes: SOME.changes.map((each) => ({
        ...each,
        author: { id: 'me', name: 'Ada', at: '2026-01-02T10:00:00.000Z' },
      })),
    }
    const { onPublish } = open(own)
    await waitFor(() => {
      expect(button()).toHaveAccessibleDescription(/by Ada/u)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    await userEvent.click(button())

    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it('says there is nothing to publish in its panel too', async () => {
    open(NONE)
    await waitFor(() => {
      expect(button()).toHaveAttribute('aria-disabled', 'true')
    })

    await userEvent.hover(button())

    expect(await screen.findByText('No changes since this was last published.')).toBeVisible()
  })

  it('is disabled outright when the draft cannot be published, as it was', async () => {
    const { onPublish } = open(SOME, { blocked: true })

    expect(button()).toBeDisabled()
    await userEvent.click(button())
    expect(onPublish).not.toHaveBeenCalled()
  })

  it('shows it is working while it publishes', () => {
    open(SOME, { loading: true })

    expect(button()).toHaveAttribute('aria-busy', 'true')
  })

  it('is publishable when the comparison cannot be had, which is not the draft’s fault', async () => {
    const onPublish = vi.fn<() => void>()
    render(
      <PublishButton
        documentId="doc-2"
        published={null}
        saved={1}
        unsaved={false}
        loading={false}
        blocked={false}
        onPublish={onPublish}
      />,
      {
        wrapper: createHookWrapper({
          'GET /api/documents/{id}/compare': () => jsonResponse(500, { message: 'no' }),
        }),
      },
    )

    await userEvent.click(button())

    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it('has no accessibility violations', async () => {
    const { container } = open(SOME)
    await waitFor(() => {
      expect(button()).toHaveAccessibleDescription(/changed/u)
    })

    await expectNoAccessibilityViolations(container)
  })
})
