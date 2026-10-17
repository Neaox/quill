import { parseMarkdown, renderHtml } from '@quill/markdown'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { ANIMATION_SPECIMEN, AnimationSpecimens, SPINNER } from './animation-specimens.tsx'

describe('the animated emoji specimen (ADR-047)', () => {
  it('is drawn by the renderer as it draws one today, from the fixture instead of the server', () => {
    const served = {
      src: '/api/emoji/spinner.aaaaaaaaaaaaaaaa.gif',
      still: '/api/emoji/spinner.bbbbbbbbbbbbbbbb.gif',
      frames: SPINNER.frames,
      milliseconds: SPINNER.milliseconds,
      width: 32,
      height: 32,
    }
    const rendered = renderHtml(parseMarkdown(ANIMATION_SPECIMEN.markdown), {
      emoji: new Map([['spinner', served]]),
    })
    expect(rendered.replace(served.src, SPINNER.src).replace(served.still, SPINNER.still)).toBe(
      ANIMATION_SPECIMEN.html,
    )
  })

  it('shows the emoji moving and its still, labelled, and passes axe', async () => {
    const { container } = render(<AnimationSpecimens />)
    expect(screen.getByRole('region', { name: ANIMATION_SPECIMEN.label })).toHaveTextContent(
      ANIMATION_SPECIMEN.note,
    )
    expect(screen.getAllByRole('img', { name: ':spinner:' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: 'The spinner’s still' })).toHaveAttribute(
      'src',
      SPINNER.still,
    )
    await expectNoAccessibilityViolations(container)
  })
})
