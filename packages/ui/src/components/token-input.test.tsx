import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, onTestFinished } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { TokenInput, type TokenInputProps } from './token-input.tsx'

const KNOWN = ['database', 'deploys', 'on-call', 'ops']

/** A tag field over a fixed vocabulary, holding its own tokens as a caller would. */
function Tags(props: Partial<TokenInputProps> & { readonly initial?: readonly string[] }) {
  const [tokens, setTokens] = useState<readonly string[]>(props.initial ?? ['ops'])
  const [query, setQuery] = useState('')
  const matches = KNOWN.filter((tag) => tag.startsWith(query) && !tokens.includes(tag))
  return (
    <TokenInput
      label="Tags"
      tokens={tokens.map((tag) => ({ id: tag, label: tag }))}
      query={query}
      onQueryChange={setQuery}
      groups={
        query === '' && matches.length === KNOWN.length
          ? []
          : [
              {
                id: 'tags',
                label: 'Tags',
                options: matches.map((tag) => ({ id: tag, label: tag })),
              },
            ]
      }
      onChoose={(id) => {
        setTokens([...tokens, id])
        setQuery('')
      }}
      onEnterText={(texts) => {
        setTokens([...tokens, ...texts.filter((text) => !tokens.includes(text))])
        setQuery('')
      }}
      onRemove={(id) => {
        setTokens(tokens.filter((token) => token !== id))
      }}
      {...props}
    />
  )
}

const field = () => screen.getByRole('combobox', { name: 'Tags' })
const tokens = () =>
  within(screen.getByRole('list', { name: 'Tags' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

describe('TokenInput', () => {
  it('is a labelled combobox with its tokens listed beside it, and passes axe', async () => {
    const { container } = render(<Tags />)
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    expect(tokens()).toEqual(['ops'])
    await expectNoAccessibilityViolations(container)
  })

  it('describes the field and hints at what to type', () => {
    render(<Tags description="Up to five tags" placeholder="Add a tag" />)
    expect(field()).toHaveAccessibleDescription('Up to five tags')
    expect(field()).toHaveAttribute('placeholder', 'Add a tag')
  })

  it('suggests as somebody types, and adds the one chosen with the arrows and Enter', async () => {
    const user = userEvent.setup()
    render(<Tags />)
    await user.type(field(), 'd')
    expect(field()).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(tokens()).toEqual(['ops', 'deploys'])
    expect(field()).toHaveValue('')
    expect(field()).toHaveFocus()
  })

  it('adds what was typed, not a suggestion left from an earlier search, while the new one is busy', async () => {
    const user = userEvent.setup()
    // The suggestions still on screen answer what was typed before; the
    // search for what is typed now has not come back.
    render(
      <Tags
        busy
        groups={[{ id: 'tags', label: 'Tags', options: [{ id: 'database', label: 'database' }] }]}
      />,
    )
    await user.type(field(), 'incidents{Enter}')
    expect(tokens()).toEqual(['ops', 'incidents'])
  })

  it('adds what was typed when nothing is suggested, on Enter or on a comma', async () => {
    const user = userEvent.setup()
    render(<Tags />)
    await user.type(field(), 'incidents{Enter}')
    await user.type(field(), 'runbooks,')
    expect(tokens()).toEqual(['ops', 'incidents', 'runbooks'])
  })

  it('turns a pasted list into several tokens', async () => {
    const user = userEvent.setup()
    render(<Tags />)
    await user.click(field())
    await user.paste('alpha, beta,\ngamma')
    expect(tokens()).toEqual(['ops', 'alpha', 'beta', 'gamma'])
  })

  it('leaves a single pasted word in the field to be finished', async () => {
    const user = userEvent.setup()
    render(<Tags />)
    await user.click(field())
    await user.paste('alp')
    expect(field()).toHaveValue('alp')
  })

  it('removes the last token on Backspace in an empty field, and any token from its button', async () => {
    const user = userEvent.setup()
    render(<Tags initial={['ops', 'database', 'deploys']} />)
    await user.click(field())
    await user.keyboard('{Backspace}')
    expect(tokens()).toEqual(['ops', 'database'])
    await user.click(screen.getByRole('button', { name: 'Remove ops' }))
    expect(tokens()).toEqual(['database'])
    // Focus is never lost when the control it was on goes away.
    expect(field()).toHaveFocus()
  })

  it('closes the suggestions on Escape, and lets a second Escape through to whatever holds it', async () => {
    const user = userEvent.setup()
    let escaped = 0
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escaped += 1
    }
    document.addEventListener('keydown', listener)
    onTestFinished(() => {
      document.removeEventListener('keydown', listener)
    })
    render(<Tags />)
    await user.type(field(), 'd')
    await user.keyboard('{Escape}')
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    expect(escaped).toBe(0)
    await user.keyboard('{Escape}')
    expect(escaped).toBe(1)
  })

  it('walks back up the suggestions, opens them from the keyboard, and takes one by pointer', async () => {
    const user = userEvent.setup()
    render(<Tags />)
    await user.type(field(), 'd')
    await user.keyboard('{Escape}')
    await user.keyboard('{ArrowUp}')
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{ArrowDown}')
    expect(field()).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowDown}{ArrowUp}')
    expect(field()).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'database' }).id,
    )
    await user.click(screen.getByRole('option', { name: 'deploys' }))
    expect(tokens()).toEqual(['ops', 'deploys'])
  })

  it('shows a notice in place of suggestions, and says when it is busy', async () => {
    const user = userEvent.setup()
    render(<Tags groups={[]} notice="Searching…" busy />)
    await user.type(field(), 'x')
    expect(screen.getByText('Searching…')).toBeInTheDocument()
    expect(field()).toHaveAttribute('aria-busy', 'true')
  })

  it('does not add text when it only takes suggestions', async () => {
    const user = userEvent.setup()
    render(<Tags onEnterText={undefined} />)
    await user.type(field(), 'nothing{Enter}')
    expect(tokens()).toEqual(['ops'])
    // A comma is just a character to a field that only takes suggestions.
    await user.type(field(), ',')
    expect(field()).toHaveValue('nothing,')
    // Backspace edits what is typed before it ever removes a token.
    await user.keyboard('{Backspace}')
    expect(tokens()).toEqual(['ops'])
  })

  it('has nothing to remove with Backspace when it holds no tokens', async () => {
    const user = userEvent.setup()
    render(<Tags initial={[]} />)
    await user.click(field())
    await user.keyboard('{Backspace}')
    expect(screen.getByRole('list', { name: 'Tags' })).toBeEmptyDOMElement()
  })

  it('shows tokens without controls when it cannot be changed', () => {
    render(<Tags disabled />)
    expect(field()).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Remove ops' })).toBeNull()
  })
})
