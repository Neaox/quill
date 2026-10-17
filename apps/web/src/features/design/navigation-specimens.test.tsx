import { fillChildPagesSlots, parseMarkdown, renderHtml } from '@quill/markdown'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  NAVIGATION_BLOCK_SPECIMENS,
  NavigationBlockSpecimens,
  SPECIMEN_CHILD_PAGES,
} from './navigation-specimens.tsx'

describe('the navigation specimens (ADR-049)', () => {
  it('are drawn by the renderer, and filled by the template, as they are today', () => {
    for (const specimen of NAVIGATION_BLOCK_SPECIMENS) {
      const body = renderHtml(parseMarkdown(specimen.markdown))
      const drawn =
        specimen.pages === undefined
          ? body
          : fillChildPagesSlots(body, () =>
              specimen.pages === 'sample' ? SPECIMEN_CHILD_PAGES : [],
            )
      expect(drawn).toBe(specimen.html)
    }
  })

  it('show every block, each named, and pass axe', async () => {
    const { container } = render(<NavigationBlockSpecimens />)
    for (const specimen of NAVIGATION_BLOCK_SPECIMENS) {
      expect(screen.getByRole('region', { name: specimen.label })).toHaveTextContent(specimen.note)
    }
    const contents = screen.getByRole('navigation', { name: 'On this page' })
    expect(within(contents).getAllByRole('link')).toHaveLength(5)
    expect(screen.getByText('No child pages yet')).toBeDefined()
    await expectNoAccessibilityViolations(container)
  })
})
