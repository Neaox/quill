import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { CodeBlock } from './code-block.tsx'

describe('CodeBlock', () => {
  it('is a labelled group a keyboard can reach, because it scrolls', async () => {
    const { container } = render(
      <CodeBlock label="verify.ts">{'export const verify = () => {}'}</CodeBlock>,
    )

    const block = screen.getByRole('group', { name: 'verify.ts' })
    expect(block.tagName).toBe('PRE')
    await userEvent.tab()
    expect(block).toHaveFocus()
    await expectNoAccessibilityViolations(container)
  })

  it('names its source and carries its own controls', async () => {
    const { container } = render(
      <CodeBlock
        label="verify.ts"
        source="src/auth/verify.ts @ 8f31c72 L42-71"
        actions={<button type="button">Copy</button>}
        className="mt-4"
      >
        {'export const verify = () => {}'}
      </CodeBlock>,
    )

    expect(screen.getByText('src/auth/verify.ts @ 8f31c72 L42-71')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('renders no caption strip when there is nothing to put in it', () => {
    const { container } = render(<CodeBlock label="verify.ts">{'const a = 1'}</CodeBlock>)

    expect(container.querySelector('figcaption')).toBeNull()
  })

  it('renders a source without controls', () => {
    const { container } = render(
      <CodeBlock label="verify.ts" source="src/auth/verify.ts">
        {'const a = 1'}
      </CodeBlock>,
    )

    expect(container.querySelector('figcaption')).not.toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('leaves the token classes to whatever produced them', () => {
    render(
      <CodeBlock label="verify.ts">
        <span className="tok-keyword">export</span>
        <span> </span>
        <span className="tok-function">verify</span>
      </CodeBlock>,
    )

    expect(screen.getByText('export')).toHaveClass('tok-keyword')
    expect(screen.getByText('verify')).toHaveClass('tok-function')
  })
})
