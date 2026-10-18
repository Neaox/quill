import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LinkEditor } from './link-editor.tsx'

describe('the link box of an editor with nothing to show a link as', () => {
  it('asks for an address and offers no choice of display, applying as a plain link', async () => {
    const onApply = vi.fn<(href: string, display: string) => void>()
    const user = userEvent.setup()
    render(
      <LinkEditor
        href={null}
        onApply={onApply}
        onRemove={() => undefined}
        onCancel={() => undefined}
      />,
    )
    expect(screen.queryByRole('radiogroup', { name: 'Show link as' })).toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Link address' }), 'https://example.com')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith('https://example.com', 'url')
  })
})
