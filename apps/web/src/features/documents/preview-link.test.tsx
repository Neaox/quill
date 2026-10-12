import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { draftPreviewHref, PreviewLink, readerPreviewHref } from './preview-link.tsx'

/** A tab that was opened, and the address it was sent to. */
function openedTab() {
  const tab = { location: { href: '' }, opener: {} as unknown }
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
  return { tab, open }
}

describe('PreviewLink', () => {
  it('is a link to the server-rendered reader preview of the document', () => {
    render(<PreviewLink documentRef="the-sync-map-j9t064k4d7" />)
    const link = screen.getByRole('link', { name: /^Preview\s+as a reader/u })
    expect(link.getAttribute('href')).toBe('/preview/d/the-sync-map-j9t064k4d7')
  })

  it('opens in a new tab, says so, and gives the new page no handle on this one', () => {
    render(<PreviewLink documentRef="the-sync-map-j9t064k4d7" />)
    const link = screen.getByRole('link', { name: /opens in a new tab/u })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener')
  })

  it('shows a short label, and takes the button’s look from the primitive', () => {
    render(<PreviewLink documentRef="x-k000000001" />)
    const link = screen.getByRole('link')
    expect(link.textContent).toContain('Preview')
    expect(link.className).toContain('rounded-md')
  })

  it('gives its word up to an eye on a phone, as Present and Share do, keeping its name', () => {
    render(<PreviewLink documentRef="x-k000000001" />)
    const link = screen.getByRole('link', { name: /^Preview\s+as a reader/u })
    expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(screen.getByText('Preview')).toHaveClass('max-lg:sr-only')
  })

  it('encodes a reference it is handed, so a path segment stays one segment', () => {
    expect(readerPreviewHref('a/b?c')).toBe('/preview/d/a%2Fb%3Fc')
  })

  it('is the preview of the draft when it is asked to be, named for what it shows', () => {
    render(<PreviewLink documentRef="the-sync-map-j9t064k4d7" draft />)

    const link = screen.getByRole('link', { name: /^Preview\s+your unpublished changes/u })
    expect(link.getAttribute('href')).toBe('/preview/d/the-sync-map-j9t064k4d7?draft')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(draftPreviewHref('a/b?c')).toBe('/preview/d/a%2Fb%3Fc?draft')
  })

  describe('when something must be done before it can show what it is a preview of', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('opens the tab at once, so a blocker allows it, and sends it there when that is done', async () => {
      const { tab, open } = openedTab()
      const blocker = Promise.withResolvers<void>()
      const before = vi.fn<() => Promise<void>>(() => blocker.promise)
      render(<PreviewLink documentRef="x-k000000001" draft beforeOpen={before} />)

      await userEvent.click(screen.getByRole('link'))

      expect(open).toHaveBeenCalledTimes(1)
      expect(before).toHaveBeenCalledTimes(1)
      expect(tab.location.href).toBe('')
      blocker.resolve()
      await vi.waitFor(() => {
        expect(tab.location.href).toBe('/preview/d/x-k000000001?draft')
      })
      expect(tab.opener).toBeNull()
    })

    it('opens the address in a tab of its own when the browser gave it none to hold', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null)
      render(<PreviewLink documentRef="x-k000000001" draft beforeOpen={() => Promise.resolve()} />)

      await userEvent.click(screen.getByRole('link'))

      await vi.waitFor(() => {
        expect(open).toHaveBeenLastCalledWith('/preview/d/x-k000000001?draft', '_blank')
      })
    })

    it('is an ordinary link when there is nothing to wait for', async () => {
      const open = vi.spyOn(window, 'open')
      render(<PreviewLink documentRef="x-k000000001" />)

      await userEvent.click(screen.getByRole('link')).catch(() => undefined)

      expect(open).not.toHaveBeenCalled()
    })
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<PreviewLink documentRef="x-k000000001" />)
    await expectNoAccessibilityViolations(container)
  })
})
