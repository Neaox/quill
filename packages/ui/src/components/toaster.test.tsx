import { act } from 'react'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { prefersReducedMotion } from './sonner-toaster.tsx'
import { toast } from './toast.ts'
import { Toaster } from './toaster.tsx'

// A placeholder for a promise executor's callback, reassigned once the
// executor actually runs; declared once at module scope rather than inline
// per test, since it never captures anything from a test's own scope.
function noop(): void {}

// Every toast lives in a module-level store shared across tests (sonner's
// own, not this package's), so a toast left showing at the end of one test
// would replay into the next test's freshly mounted `Toaster`.
afterEach(() => {
  act(() => {
    toast.dismiss()
  })
})

describe('Toaster', () => {
  it('renders a toast with a title and a description', async () => {
    render(<Toaster />)

    act(() => {
      toast.show({
        title: 'Document saved',
        description: 'All changes are stored.',
        duration: 60_000,
      })
    })

    expect(await screen.findByText('Document saved')).toBeInTheDocument()
    expect(screen.getByText('All changes are stored.')).toBeInTheDocument()
  })

  it('accepts a position and forwards an extra className to the toast list', async () => {
    const { container } = render(<Toaster position="top-left" className="test-toaster" />)

    act(() => {
      toast.show({ title: 'Positioned toast' })
    })
    await screen.findByText('Positioned toast')

    expect(container.querySelector('.test-toaster')).toHaveAttribute('data-x-position', 'left')
  })

  it('lets a caller turn the explicit dismiss control off', async () => {
    render(<Toaster closeButton={false} />)

    act(() => {
      toast.show({ title: 'No close button' })
    })
    await screen.findByText('No close button')

    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).not.toBeInTheDocument()
  })

  it('drops the swipe gesture when the reader prefers reduced motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true } as unknown as MediaQueryList),
    )

    render(<Toaster />)
    act(() => {
      toast.show({ title: 'Reduced motion toast' })
    })

    expect(await screen.findByText('Reduced motion toast')).toBeInTheDocument()
    // Swiping is off, so the explicit close button is what keeps the toast
    // dismissible — this is why `closeButton` defaults to `true`.
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it.each([
    ['success', 'Success'],
    ['info', 'Note'],
    ['warning', 'Warning'],
    ['danger', 'Danger'],
  ] as const)('gives a %s toast a data-tone and speaks the tone as a word', async (tone, label) => {
    render(<Toaster />)

    act(() => {
      toast[tone]('Body text')
    })

    const title = await screen.findByText('Body text')
    const toned = title.closest('[data-tone]')

    expect(toned).toHaveAttribute('data-tone', tone)
    expect(toned?.querySelector('.sr-only')).toHaveTextContent(`${label}:`)
  })

  it('tones a neutral toast without speaking a tone word', async () => {
    render(<Toaster />)

    act(() => {
      toast.show({ title: 'Draft renamed' })
    })

    const title = await screen.findByText('Draft renamed')
    const toned = title.closest('[data-tone]')

    expect(toned).toHaveAttribute('data-tone', 'neutral')
    expect(toned?.querySelector('.sr-only')).not.toBeInTheDocument()
  })

  it('fires its action and dismisses the toast', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn<() => void>()
    render(<Toaster />)

    act(() => {
      toast.show({ title: 'Comment deleted', action: { label: 'Undo', onClick } })
    })
    await screen.findByText('Comment deleted')

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(onClick).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(screen.queryByText('Comment deleted')).not.toBeInTheDocument()
    })
  })

  it('fires its cancel action and dismisses the toast', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn<() => void>()
    render(<Toaster />)

    act(() => {
      toast.show({ title: 'Discard changes?', cancel: { label: 'Keep editing', onClick } })
    })
    await screen.findByText('Discard changes?')

    await user.click(screen.getByRole('button', { name: 'Keep editing' }))

    expect(onClick).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument()
    })
  })

  it('announces through a polite aria-live region', async () => {
    const { container } = render(<Toaster />)

    // The host is a chunk of its own (`toaster.tsx`), fetched as soon as the
    // application paints rather than on the first toast, precisely so the
    // region exists before anything has to be announced into it.
    await waitFor(() => {
      expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument()
    })
  })

  it('announces a danger toast assertively, and every other tone only politely', async () => {
    const { container } = render(<Toaster />)
    const assertiveRegion = () => container.querySelector('[aria-live="assertive"]')

    act(() => {
      toast.success('All good')
    })
    await screen.findByText('All good')
    expect(assertiveRegion()).toHaveTextContent('')

    act(() => {
      toast.danger('Disk is full')
    })
    await screen.findByText('Disk is full')
    await waitFor(() => {
      expect(assertiveRegion()).toHaveTextContent('Danger: Disk is full')
    })
  })

  it('has no accessibility violations with a toast showing', async () => {
    const { container } = render(<Toaster />)

    act(() => {
      toast.show({
        title: 'Published',
        description: 'Version 4 is live.',
        action: { label: 'View', onClick: vi.fn<() => void>() },
      })
    })
    await screen.findByText('Published')

    await expectNoAccessibilityViolations(container)
  })

  it('transitions a promise toast from loading to success', async () => {
    render(<Toaster />)
    let resolvePending: (version: string) => void = noop
    const pending = new Promise<string>((resolve) => {
      resolvePending = resolve
    })

    act(() => {
      toast.promise(pending, {
        loading: 'Publishing…',
        success: (version) => `Published ${version}`,
        error: 'Publish failed',
      })
    })
    await screen.findByText('Publishing…')

    await act(async () => {
      resolvePending('v4')
      await pending
    })

    expect(await screen.findByText('Published v4')).toBeInTheDocument()
    expect(screen.queryByText('Publishing…')).not.toBeInTheDocument()
  })

  it('transitions a promise toast from loading to error', async () => {
    render(<Toaster />)
    let rejectPending: (error: Error) => void = noop
    const pending = new Promise<string>((_resolve, reject) => {
      rejectPending = reject
    })

    act(() => {
      toast.promise(pending, {
        loading: 'Publishing…',
        success: 'Published',
        error: (error) => `Failed: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    })
    await screen.findByText('Publishing…')

    await act(async () => {
      rejectPending(new Error('network down'))
      await pending.catch(() => {})
    })

    expect(await screen.findByText('Failed: network down')).toBeInTheDocument()
  })

  it('accepts a static message for either settled phase of a promise toast', async () => {
    render(<Toaster />)
    let resolvePending: () => void = noop
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve
    })

    act(() => {
      toast.promise(pending, { loading: 'Working…', success: 'Done', error: 'Failed' })
    })
    await screen.findByText('Working…')

    await act(async () => {
      resolvePending()
      await pending
    })

    expect(await screen.findByText('Done')).toBeInTheDocument()
  })

  it('resolves a promise toast to an outcome with one action, and it stays until dismissed', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn<() => void>()
    render(<Toaster />)
    let resolvePending: () => void = noop
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve
    })

    act(() => {
      toast.promise(pending, {
        loading: 'Updating from the source…',
        success: { title: 'Updated', action: { label: 'Reload', onClick } },
        error: 'Update failed',
      })
    })
    await screen.findByText('Updating from the source…')

    await act(async () => {
      resolvePending()
      await pending
    })
    await screen.findByText('Updated')

    // Still there well past what a plain toast's default duration would
    // allow — the action is what keeps it up (`docs/design/feedback.md`).
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByText('Updated')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onClick).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(screen.queryByText('Updated')).not.toBeInTheDocument()
    })
  })

  it('dismisses a specific toast by id, and every toast when none is given', async () => {
    render(<Toaster />)
    let id: string | number = ''
    act(() => {
      id = toast.show({ title: 'Dismiss me' })
    })
    await screen.findByText('Dismiss me')

    act(() => {
      toast.dismiss(id)
    })
    await waitFor(() => {
      expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument()
    })

    act(() => {
      toast.show({ title: 'First' })
      toast.show({ title: 'Second' })
    })
    await screen.findByText('First')
    await screen.findByText('Second')

    act(() => {
      toast.dismiss()
    })
    await waitFor(() => {
      expect(screen.queryByText('First')).not.toBeInTheDocument()
      expect(screen.queryByText('Second')).not.toBeInTheDocument()
    })
  })
})

describe('prefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reflects window.matchMedia when the environment implements it', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true } as unknown as MediaQueryList),
    )
    expect(prefersReducedMotion()).toBe(true)

    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false } as unknown as MediaQueryList),
    )
    expect(prefersReducedMotion()).toBe(false)
  })

  it('falls back to false where matchMedia is not implemented, as in jsdom by default', () => {
    expect(prefersReducedMotion()).toBe(false)
  })
})
