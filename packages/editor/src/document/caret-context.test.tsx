import { parseDocument } from '@quill/markdown'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'

const TABLE = '| One | Two |\n| --- | --- |\n| a | b |\n'
const NOTES = 'Before.\n\n:::notes\nSpeak slowly.\n:::\n'

async function open(source: string) {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const surface = screen.getByRole('textbox', { name: 'Document' })
  const user = userEvent.setup()
  await user.click(surface)
  return { ref, surface, user }
}

const marked = (surface: HTMLElement) => [...surface.querySelectorAll('.has-caret')]

describe('showing where the caret is to someone using the keyboard', () => {
  it('marks the cell the keys have moved into, and moves the mark with the caret', async () => {
    const { ref, surface, user } = await open(TABLE)
    act(() => {
      ref.current?.editor?.commands.focus('start')
    })

    await user.keyboard('{Tab}')
    expect(marked(surface).map((cell) => cell.textContent)).toEqual(['Two'])

    await user.keyboard('{Tab}')
    expect(marked(surface).map((cell) => cell.textContent)).toEqual(['a'])
  })

  it('counts Enter in a cell as navigation, since it goes to the cell below', async () => {
    const { ref, surface, user } = await open(TABLE)
    act(() => {
      ref.current?.editor?.commands.focus('start')
    })

    await user.keyboard('{Enter}')

    expect(marked(surface).map((cell) => cell.textContent)).toEqual(['a'])
  })

  it('marks the block the caret is inside, as the one a key will act in', async () => {
    const { ref, surface, user } = await open(NOTES)
    act(() => {
      ref.current?.editor?.commands.focus('end')
    })

    await user.keyboard('{ArrowLeft}')

    expect(marked(surface).map((block) => block.className)).toEqual([
      expect.stringContaining('directive-notes'),
    ])
  })

  it('marks nothing for a pointer, which shows where it is by being there', async () => {
    const { surface, user } = await open(TABLE)
    await user.keyboard('{Tab}')

    await user.click(screen.getByText('One'))

    expect(marked(surface)).toEqual([])
  })

  it.each(['a', '{Enter}', '{Backspace}', '{Delete}', '{Control>}b{/Control}'])(
    'is not set off by writing (%s), which is a click followed by typing, not navigation',
    async (keys) => {
      const { ref, surface, user } = await open(NOTES)
      act(() => {
        ref.current?.editor?.commands.focus('end')
      })

      await user.keyboard(keys)

      expect(marked(surface)).toEqual([])
    },
  )

  it.each(['{ArrowUp}', '{ArrowDown}', '{ArrowLeft}', '{ArrowRight}', '{PageUp}'])(
    'is set off by %s, which moves the caret',
    async (keys) => {
      const { ref, surface, user } = await open(`${NOTES}
After.
`)
      act(() => {
        ref.current?.editor?.commands.setTextSelection(14)
      })

      await user.keyboard(keys)

      expect(marked(surface)).toHaveLength(1)
    },
  )

  it('is not set off by a modifier on its own, which moves nothing', async () => {
    const { surface, user } = await open(TABLE)

    await user.keyboard('{Shift}')

    expect(marked(surface)).toEqual([])
  })

  it('marks nothing where the caret is in plain text, which the caret itself shows', async () => {
    const { surface, user } = await open('Just words.\n')

    await user.keyboard('{ArrowLeft}')

    expect(marked(surface)).toEqual([])
  })
})
