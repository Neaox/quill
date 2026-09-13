import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { PresentBar, PresentHint, PresentKey } from './present-bar.tsx'

function bar(idle: boolean) {
  return (
    <PresentBar title="Authentication architecture" position="2 of 7" idle={idle}>
      <PresentHint keys={<PresentKey>G</PresentKey>}>Go to</PresentHint>
      <button type="button" onClick={() => {}}>
        Full screen
      </button>
    </PresentBar>
  )
}

describe('PresentBar', () => {
  it('says what is being presented and how far through it is', async () => {
    const { container } = render(bar(false))

    expect(screen.getByText('Authentication architecture')).toBeVisible()
    expect(screen.getByText('2 of 7')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('carries idle as an attribute, so the fade follows the attribute', () => {
    const { rerender, container } = render(bar(false))
    const root = container.querySelector('.present-bar')

    expect(root).not.toHaveAttribute('data-idle')

    rerender(bar(true))

    // Faded, not removed: the controls stay in the accessibility tree and
    // nothing reflows when the room moves again.
    expect(root).toHaveAttribute('data-idle', '')
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument()
  })

  it('names a key as a key', () => {
    render(bar(false))

    expect(screen.getByText('G').tagName).toBe('KBD')
  })
})
