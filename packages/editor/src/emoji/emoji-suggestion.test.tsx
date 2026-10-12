import { parseDocument, serializeDocument } from '@quill/markdown'
import type { CustomEmoji } from '@quill/markdown'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'

/**
 * The `:` suggestion as an author meets it: the real editor, a real keyboard, and the Markdown
 * that comes out. Typing a colon and a few letters offers the emoji they could mean, the
 * organisation's own among them, and choosing one writes its shortcode.
 */

const ACME: CustomEmoji = {
  src: '/api/emoji/acme.0123456789abcdef.svg',
  description: 'Acme’s roadrunner logo',
  width: 64,
  height: 64,
}
const GLOBEX: CustomEmoji = {
  src: '/api/emoji/globex_logo.fedcba9876543210.png',
  width: 128,
  height: 64,
}
const CUSTOM = new Map([
  ['acme', ACME],
  ['globex_logo', GLOBEX],
])

async function openWith(
  source: string,
  custom: ReadonlyMap<string, CustomEmoji> = CUSTOM,
  recentsKey?: string,
) {
  const ref = createRef<DocumentEditorHandle>()
  const rendered = render(
    <DocumentEditor
      ast={parseDocument(source).ast}
      ref={ref}
      emoji={{ custom, labelEmoji: new Map() }}
      {...(recentsKey === undefined ? {} : { recentsKey })}
    />,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('textbox', { name: 'Document' }))
  act(() => {
    ref.current?.editor?.commands.focus('end')
  })
  const markdown = () => {
    const handle = ref.current
    if (handle === null) throw new Error('No editor.')
    return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
  }
  return { user, markdown, ref, ...rendered }
}

const menu = () => screen.queryByRole('listbox', { name: 'Emoji' })
const optionNames = () =>
  within(screen.getByRole('listbox', { name: 'Emoji' }))
    .getAllByRole('option')
    .map((option) => option.querySelector('.truncate')?.textContent ?? '')

/** The menu, once GitHub's list has arrived, which is its own chunk. */
const offered = async (name: string) =>
  waitFor(() => {
    expect(optionNames()).toContain(name)
  })

beforeEach(() => {
  localStorage.clear()
})

describe('the emoji suggestion', () => {
  it.each([
    ['at the start of a line', '', ':tad'],
    ['after a space', 'Ship it', ' :tad'],
  ])('opens %s, offering what the letters could mean', async (_where, before, typed) => {
    const { user } = await openWith(before)

    await user.keyboard(typed)

    await offered('tada')
    expect(menu()).toBeInTheDocument()
  })

  it('offers names that start as typed, not names that merely contain the letters', async () => {
    const { user } = await openWith('')

    await user.keyboard(':tad')
    await offered('tada')

    expect(optionNames().every((name) => name.startsWith('tad') || name.includes('_tad'))).toBe(
      true,
    )
  })

  it('writes the shortcode, and the words go on after it', async () => {
    const { user, markdown } = await openWith('Ship it')

    await user.keyboard(' :tad')
    await offered('tada')
    await user.keyboard('{Enter}')
    await user.keyboard(' now')

    expect(markdown()).toBe('Ship it :tada: now\n')
    expect(menu()).toBeNull()
  })

  it('goes past the space that follows, so the emoji is drawn at once', async () => {
    const { user, markdown, ref } = await openWith('Ship it  now')
    act(() => {
      ref.current?.editor?.commands.setTextSelection(9)
    })

    await user.keyboard(':tad')
    await offered('tada')
    await user.keyboard('{Tab}')
    await user.keyboard('!')

    expect(markdown()).toBe('Ship it :tada: !now\n')
  })

  it('adds a space where words follow with none, so the shortcode stands apart', async () => {
    const { user, markdown, ref } = await openWith('Ship itnow')
    act(() => {
      ref.current?.editor?.commands.setTextSelection(8)
    })

    await user.keyboard(' :tad')
    await offered('tada')
    await user.keyboard('{Enter}')

    expect(markdown()).toBe('Ship it :tada: now\n')
  })

  it('takes the first match with Enter, and the one arrowed to when there is one', async () => {
    const { user, markdown } = await openWith('')

    await user.keyboard(':smil')
    await offered('smile')
    const [first, second] = optionNames()
    await user.keyboard('{Enter}')
    expect(markdown()).toBe(`:${first}:
`)

    await user.keyboard(' :smil')
    await offered('smile')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(markdown()).toBe(`:${first}: :${second}:
`)
  })

  it('lets Escape close it and leave what was typed', async () => {
    const { user, markdown } = await openWith('')

    await user.keyboard(':rocke')
    await offered('rocket')
    await user.keyboard('{Escape}')

    expect(menu()).toBeNull()
    expect(markdown()).toBe('\\:rocke\n')
  })

  it('offers the organisation’s own first, by their picture, and what each shows', async () => {
    const { user } = await openWith('')

    await user.keyboard(':ac')
    await offered('acme')

    const option = within(screen.getByRole('listbox', { name: 'Emoji' })).getAllByRole('option')[0]
    expect(option).toHaveTextContent('Acme’s roadrunner logo')
    expect(option?.querySelector('img')).toHaveAttribute('src', ACME.src)
    // The words are what is read; the picture beside them says nothing more.
    expect(option?.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('says an undescribed custom emoji by its name in words, and finds it by any part of it', async () => {
    const { user } = await openWith('')

    await user.keyboard(':globex')
    await offered('globex_logo')

    expect(screen.getByRole('option', { name: /globex logo/u })).toBeInTheDocument()
  })

  it('draws a standard emoji by its character, and names it for a screen reader by its words', async () => {
    const { user } = await openWith('')

    await user.keyboard(':tad')
    await offered('tada')

    const option = screen.getByRole('option', { name: /tada/u })
    expect(option).toHaveTextContent('party popper')
    expect(option.querySelector('[aria-hidden="true"]')).toHaveTextContent('🎉')
  })

  it('finds an emoji by another of its names, and writes the one it is known by', async () => {
    const { user, markdown } = await openWith('')

    await user.keyboard(':thumbsu')
    await offered('+1')
    await user.keyboard('{Enter}')

    expect(markdown()).toBe(':+1:\n')
  })

  it.each([
    ['inside a word', 'a', ':tad'],
    ['in a time', '10', ':30'],
    ['in an address', 'https', '://tad'],
  ])('stays shut %s, where a colon is not asking for an emoji', async (_where, before, typed) => {
    const { user } = await openWith('')

    await user.keyboard(`${before}${typed}`)

    expect(menu()).toBeNull()
  })

  it('opens on the colon itself, with the organisation’s own emoji first, then the letters narrow it', async () => {
    const { user } = await openWith('')

    await user.keyboard(':')
    await offered('acme')
    expect(optionNames().slice(0, 2)).toEqual(['acme', 'globex_logo'])

    await user.keyboard('t')
    await waitFor(() => {
      expect(optionNames().every((name) => name.startsWith('t'))).toBe(true)
    })
  })

  it('remembers what was chosen, and offers it first the next time the colon is typed', async () => {
    const first = await openWith('', CUSTOM, 'editor.test')
    await first.user.keyboard(':rocke')
    await offered('rocket')
    await first.user.keyboard('{Enter}')
    expect(localStorage.getItem('editor.test.emoji')).toBe('["rocket"]')
    first.unmount()

    const { user } = await openWith('', CUSTOM, 'editor.test')
    await user.keyboard(':')
    await offered('acme')

    const recent = within(screen.getByRole('group', { name: 'Recently used' }))
    expect(recent.getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('rocket'),
    ])
  })

  it('keeps what it remembers apart from the slash menu’s, which are blocks', async () => {
    const { user } = await openWith('', CUSTOM, 'editor.test')
    await user.keyboard(':rocke')
    await offered('rocket')
    await user.keyboard('{Enter}')

    expect(localStorage.getItem('editor.test')).toBeNull()
  })

  it('closes on the space that follows, which is a colon in prose', async () => {
    const { user } = await openWith('')

    await user.keyboard(':')
    await offered('acme')
    await user.keyboard(' a note')

    expect(menu()).toBeNull()
  })

  it('stays shut for what is not a name, and where nothing matches', async () => {
    const { user } = await openWith('')

    await user.keyboard(':)')
    expect(menu()).toBeNull()
    await user.keyboard(' :zzzzqq')
    expect(menu()).toBeNull()
  })

  it('closes when the shortcode is finished by hand, and leaves it written', async () => {
    const { user, markdown } = await openWith('')

    await user.keyboard(':tad')
    await offered('tada')
    await user.keyboard('a:')

    expect(menu()).toBeNull()
    expect(markdown()).toBe(':tada:\n')
  })

  it('is not offered in code', async () => {
    const { user } = await openWith('')

    await user.keyboard('`:tad')

    expect(menu()).toBeNull()
  })

  it('is one undo: it gives back what was typed', async () => {
    const { user, ref } = await openWith('')

    await user.keyboard(':tad')
    await offered('tada')
    await user.keyboard('{Enter}')
    await user.keyboard('{Control>}z{/Control}')

    expect(ref.current?.editor?.getText()).toBe(':tad')
  })

  it('has nothing for an axe check to object to', async () => {
    const { user, container } = await openWith('')

    await user.keyboard(':ac')
    await offered('acme')

    await expectNoAccessibilityViolations(container)
  })
})
