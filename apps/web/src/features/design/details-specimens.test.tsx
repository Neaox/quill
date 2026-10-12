import { parseMarkdown, renderHtml } from '@quill/markdown'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { DETAILS_SPECIMENS, DetailsSpecimens } from './details-specimens.tsx'

describe('the details specimens (ADR-048)', () => {
  it('are drawn by the renderer as it draws them today', () => {
    for (const specimen of DETAILS_SPECIMENS) {
      expect(renderHtml(parseMarkdown(specimen.markdown))).toBe(specimen.html)
    }
  })

  it('show every form, each named, and pass axe', async () => {
    const { container } = render(<DetailsSpecimens />)
    for (const specimen of DETAILS_SPECIMENS) {
      expect(screen.getByRole('region', { name: specimen.label })).toHaveTextContent(specimen.note)
    }
    expect(container.querySelectorAll('details.details').length).toBeGreaterThan(6)
    await expectNoAccessibilityViolations(container)
  })
})
