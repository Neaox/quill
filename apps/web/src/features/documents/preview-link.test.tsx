import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { PreviewLink, readerPreviewHref } from './preview-link.tsx'

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

  it('has no accessibility violations', async () => {
    const { container } = render(<PreviewLink documentRef="x-k000000001" />)
    await expectNoAccessibilityViolations(container)
  })
})
