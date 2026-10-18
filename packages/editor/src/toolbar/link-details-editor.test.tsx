import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LinkDetailsEditor } from './link-details-editor.tsx'
import type { CardDetails } from './link-details-editor.tsx'

function open(current: CardDetails) {
  const onApply = vi.fn<(details: CardDetails) => void>()
  render(
    <LinkDetailsEditor
      current={current}
      fetched={null}
      onApply={onApply}
      onReset={() => undefined}
      onCancel={() => undefined}
    />,
  )
  return { onApply, user: userEvent.setup() }
}

describe('the box for a card’s own title and description', () => {
  it('applies the words typed, trimmed', async () => {
    const { onApply, user } = open({ title: null, description: null })
    await user.type(screen.getByRole('textbox', { name: 'Card title' }), '  Our take  ')
    await user.type(screen.getByRole('textbox', { name: 'Card description' }), '  Why  ')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith({ title: 'Our take', description: 'Why' })
  })

  it('applies nothing of its own for empty fields, which means the page’s words', async () => {
    const { onApply, user } = open({ title: 'Mine', description: 'Mine too' })
    await user.clear(screen.getByRole('textbox', { name: 'Card title' }))
    await user.clear(screen.getByRole('textbox', { name: 'Card description' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith({ title: null, description: null })
  })

  it('applies an empty description to hide it, when asked to', async () => {
    const { onApply, user } = open({ title: null, description: 'Mine too' })
    await user.click(screen.getByRole('checkbox', { name: 'No description' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith({ title: null, description: '' })
  })
})
