import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { LinkPreviewPanel } from './link-preview-panel.tsx'

const image = (hash: string) => ({ hash, width: 600, height: 315 })
const imageUrl = (picture: { readonly hash: string }) => `/pictures/${picture.hash}`

function renderPanel(overrides: Partial<Parameters<typeof LinkPreviewPanel>[0]> = {}) {
  return render(
    <LinkPreviewPanel
      id="peek"
      title="How we cut build times"
      description="Caching and parallelism, with numbers."
      siteName="Engineering blog"
      host="blog.example"
      thumbnail={image('a'.repeat(64))}
      favicon={image('b'.repeat(64))}
      imageUrl={imageUrl}
      {...overrides}
    />,
  )
}

describe('LinkPreviewPanel', () => {
  it('says what the page is: its title, what it says, and where it is from', () => {
    renderPanel()
    expect(screen.getByText('How we cut build times')).toBeVisible()
    expect(screen.getByText('Caching and parallelism, with numbers.')).toBeVisible()
    expect(screen.getByText('Engineering blog')).toBeVisible()
  })

  it('is a tooltip a control can name as its description', () => {
    renderPanel()
    expect(screen.getByRole('tooltip')).toHaveAttribute('id', 'peek')
  })

  it('draws the pictures from our own origin, as decoration, at the size they were stored', () => {
    const { container } = renderPanel()
    const pictures = [...container.querySelectorAll('img')]
    expect(pictures.map((picture) => picture.getAttribute('src'))).toEqual([
      `/pictures/${'a'.repeat(64)}`,
      `/pictures/${'b'.repeat(64)}`,
    ])
    for (const picture of pictures) expect(picture).toHaveAttribute('alt', '')
    expect(pictures[0]).toHaveAttribute('width', '600')
    expect(pictures[0]).toHaveAttribute('height', '315')
  })

  it('falls back to the address when the page named no site, and omits what it lacks', () => {
    const { container } = renderPanel({
      siteName: null,
      description: null,
      thumbnail: null,
      favicon: null,
    })
    expect(screen.getByText('blog.example')).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
  })

  it('has no accessibility violations', async () => {
    const { container } = renderPanel()
    await expectNoAccessibilityViolations(container)
  })
})
