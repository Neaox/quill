import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { FindBar } from './find-bar.tsx'

/**
 * Find and replace as someone meets it: the real editor, the real bar and a real keyboard.
 */

const NL = String.fromCharCode(10)
const DOC = 'The plan is a plan.' + NL + NL + 'Plan again, then PLAN.' + NL

async function openEditor(source = DOC) {
  const ref = createRef<DocumentEditorHandle>()
  const rendered = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const user = userEvent.setup()
  const surface = screen.getByRole('textbox', { name: 'Document' })
  await user.click(surface)
  const markdown = () => {
    const handle = ref.current
    if (handle === null) throw new Error('No editor.')
    return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
  }
  const select = (from: number, to: number) => {
    act(() => {
      ref.current?.editor?.commands.setTextSelection({ from, to })
    })
  }
  return { user, surface, markdown, select, ref, ...rendered }
}

const bar = () => screen.getByRole('search', { name: 'Find and replace' })
const findField = () => within(bar()).getByRole('textbox', { name: 'Find' })
const replaceField = () => within(bar()).getByRole('textbox', { name: 'Replace' })
const toggle = (name: RegExp) => within(bar()).getByRole('button', { name })
const status = () => within(bar()).getByRole('status')

describe('opening the find bar', () => {
  it('opens on Ctrl+F with the focus in its field, and closes on Escape with the caret back in the document', async () => {
    const { user, surface } = await openEditor()

    await user.keyboard('{Control>}f{/Control}')
    expect(findField()).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('search', { name: 'Find and replace' })).toBeNull()
    await waitFor(() => {
      expect(surface).toHaveFocus()
    })
  })

  it('starts with what was selected, selected so that typing replaces it', async () => {
    const { user, select } = await openEditor()
    select(5, 9)

    await user.keyboard('{Control>}f{/Control}')

    expect(findField()).toHaveValue('plan')
    expect(findField()).toHaveFocus()
    await user.keyboard('x')
    expect(findField()).toHaveValue('x')
  })

  it('opens with the replace row on Ctrl+H, and shows or hides it from the chevron', async () => {
    const { user } = await openEditor()

    await user.keyboard('{Control>}h{/Control}')
    expect(replaceField()).toBeInTheDocument()

    await user.click(toggle(/toggle replace/iu))
    expect(within(bar()).queryByRole('textbox', { name: 'Replace' })).toBeNull()
  })

  it('brings the replace row and its field up with Ctrl+H from inside the bar, keeping the query as it was', async () => {
    const { user } = await withBar()
    await user.type(findField(), String.raw`pl\w+`)
    await user.click(toggle(/use regular expression/iu))

    await user.keyboard('{Control>}h{/Control}')

    expect(replaceField()).toHaveFocus()
    expect(findField()).toHaveValue(String.raw`pl\w+`)
  })

  it('takes the focus again when asked for again, wherever it had gone', async () => {
    const { user, surface } = await openEditor()
    await user.keyboard('{Control>}f{/Control}')
    await user.click(surface)

    await user.keyboard('{Control>}f{/Control}')

    expect(findField()).toHaveFocus()
  })

  it('has nothing for an axe check to object to', async () => {
    const { user, container } = await openEditor()
    await user.keyboard('{Control>}h{/Control}')
    await user.keyboard('plan')

    await expectNoAccessibilityViolations(container)
  })
})

describe('finding', () => {
  it('says how many there are as the query is typed, and which one the selection is on as it steps', async () => {
    const { user, selectionText } = await withBar()
    await user.keyboard('plan')

    expect(status()).toHaveTextContent('4 results')
    await user.keyboard('{Enter}')
    expect(status()).toHaveTextContent('1 of 4')
    expect(selectionText()).toBe('plan')
    await user.keyboard('{Enter}{Enter}{Enter}{Enter}')
    expect(status()).toHaveTextContent('1 of 4')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(status()).toHaveTextContent('4 of 4')
    expect(selectionText()).toBe('PLAN')
  })

  it('says when there is nothing, and when the expression is not one', async () => {
    const { user } = await withBar()
    await user.keyboard('zzz')
    expect(status()).toHaveTextContent('No results')

    await user.clear(findField())
    await user.click(toggle(/use regular expression/iu))
    await user.type(findField(), '(plan')

    expect(findField()).toBeInvalid()
    expect(status()).toHaveTextContent(/Invalid expression/u)
  })

  it('narrows to matching case, as a pressed button', async () => {
    const { user } = await withBar()
    await user.keyboard('plan')

    await user.click(toggle(/match case/iu))

    expect(toggle(/match case/iu)).toHaveAttribute('aria-pressed', 'true')
    expect(status()).toHaveTextContent('2 results')
  })

  it('finds by a regular expression when that is switched on', async () => {
    const { user } = await withBar()
    await user.click(toggle(/use regular expression/iu))

    await user.type(findField(), String.raw`pl\w+`)

    expect(status()).toHaveTextContent('4 results')
  })

  it('toggles an option from the keyboard with Alt and its letter', async () => {
    const { user } = await withBar()
    await user.keyboard('plan')

    await user.keyboard('{Alt>}c{/Alt}')

    expect(toggle(/match case/iu)).toHaveAttribute('aria-pressed', 'true')
    expect(status()).toHaveTextContent('2 results')
  })

  it('highlights every match in the document', async () => {
    const { user, surface } = await withBar()
    await user.keyboard('plan')

    expect(surface.querySelectorAll('.find-match')).toHaveLength(4)
  })
})

describe('replacing', () => {
  it('replaces the current match with Enter in the replace field, and goes on to the next', async () => {
    const { user, markdown } = await withBar(true)
    await user.keyboard('plan')
    await user.click(replaceField())
    await user.keyboard('scheme{Enter}{Enter}')

    expect(markdown()).toBe('The scheme is a plan.' + NL + NL + 'Plan again, then PLAN.' + NL)
  })

  it('replaces all of them from its button, or with Ctrl+Alt+Enter, as one step', async () => {
    const { user, markdown } = await withBar(true)
    await user.keyboard('plan')
    await user.click(replaceField())
    await user.keyboard('scheme')

    await user.click(within(bar()).getByRole('button', { name: /replace all/iu }))

    expect(markdown()).toBe('The scheme is a scheme.' + NL + NL + 'scheme again, then scheme.' + NL)
  })

  it('takes a regular expression’s groups apart in the replacement', async () => {
    const { user, markdown } = await withBar(true, 'Ada is here.' + NL)
    await user.click(toggle(/use regular expression/iu))
    await user.type(findField(), String.raw`(\w+) is (\w+)`)
    await user.click(replaceField())
    await user.keyboard('$2 is $1{Control>}{Alt>}{Enter}{/Alt}{/Control}')

    expect(markdown()).toBe('here is Ada.' + NL)
  })

  it('keeps the case of what it replaces when asked to', async () => {
    const { user, markdown } = await withBar(true)
    await user.keyboard('plan')
    await user.click(toggle(/preserve case/iu))
    await user.click(replaceField())
    await user.keyboard('scheme')

    await user.click(within(bar()).getByRole('button', { name: /replace all/iu }))

    expect(markdown()).toBe('The scheme is a scheme.' + NL + NL + 'Scheme again, then SCHEME.' + NL)
  })

  it('has nothing to replace, and says so by being disabled, where nothing is found', async () => {
    const { user } = await withBar(true)
    await user.keyboard('zzz')

    expect(within(bar()).getByRole('button', { name: /replace all/iu })).toBeDisabled()
    expect(within(bar()).getByRole('button', { name: /^replace$/iu })).toBeDisabled()
  })
})

describe('the rest of the bar', () => {
  it('steps with its buttons, as with Enter', async () => {
    const { user, selectionText } = await withBar()
    await user.keyboard('plan')

    await user.click(within(bar()).getByRole('button', { name: 'Next match' }))
    expect(status()).toHaveTextContent('1 of 4')
    await user.click(within(bar()).getByRole('button', { name: 'Previous match' }))
    expect(status()).toHaveTextContent('4 of 4')
    expect(selectionText()).toBe('PLAN')
  })

  it('narrows to whole words, and to a selection, from their buttons', async () => {
    const { user, select } = await openEditor('plan, planned and plan again' + NL)
    select(1, 14)
    await user.keyboard('{Control>}f{/Control}')
    await user.clear(findField())
    await user.type(findField(), 'plan')
    expect(status()).toHaveTextContent('3 results')

    await user.click(toggle(/match whole word/iu))
    expect(status()).toHaveTextContent('2 results')
    await user.click(toggle(/find in selection/iu))

    expect(toggle(/find in selection/iu)).toHaveAttribute('aria-pressed', 'true')
    expect(status()).toHaveTextContent('1 result')
  })

  it('replaces one at a time from its button', async () => {
    const { user, markdown } = await withBar(true)
    await user.keyboard('plan')
    await user.click(replaceField())
    await user.keyboard('scheme')

    const replace = within(bar()).getByRole('button', { name: /^replace$/iu })
    await user.click(replace)
    await user.click(replace)

    expect(markdown()).toBe('The scheme is a plan.' + NL + NL + 'Plan again, then PLAN.' + NL)
  })

  it('closes from its button with the caret back in the document', async () => {
    const { user, surface } = await withBar()

    await user.click(within(bar()).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('search', { name: 'Find and replace' })).toBeNull()
    await waitFor(() => {
      expect(surface).toHaveFocus()
    })
  })

  it('goes back to the find field with Ctrl+F from the replace field, and keeps Enter on a button its own', async () => {
    const { user } = await withBar(true)
    await user.keyboard('plan')
    await user.click(replaceField())

    await user.keyboard('{Control>}f{/Control}')
    expect(findField()).toHaveFocus()

    within(bar()).getByRole('button', { name: 'Match case' }).focus()
    await user.keyboard('{Enter}')
    expect(toggle(/match case/iu)).toHaveAttribute('aria-pressed', 'true')
    expect(status()).toHaveTextContent('2 results')
  })

  it('does not draw while closed, and an editor can be read-only', async () => {
    const { surface } = await openEditor()

    expect(surface.querySelectorAll('.find-match')).toHaveLength(0)
  })
})

describe('showing where a step got to', () => {
  it('brings a match that is off the page into view when Enter steps to it', async () => {
    const { user, ref } = await withBar()
    const scrollIntoView = vi.fn<(options: ScrollIntoViewOptions) => void>()
    Element.prototype.scrollIntoView = scrollIntoView
    const view = ref.current?.editor?.view
    if (view === undefined) throw new Error('No editor.')
    // A page of 768 pixels, with the match drawn far below it.
    view.coordsAtPos = () => ({ left: 0, right: 0, top: 2000, bottom: 2020 })
    await user.keyboard('plan')

    await user.keyboard('{Enter}')

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
  })

  it('leaves the page alone when the match is in view', async () => {
    const { user, ref } = await withBar()
    const scrollIntoView = vi.fn<(options: ScrollIntoViewOptions) => void>()
    Element.prototype.scrollIntoView = scrollIntoView
    const view = ref.current?.editor?.view
    if (view === undefined) throw new Error('No editor.')
    view.coordsAtPos = () => ({ left: 0, right: 0, top: 300, bottom: 320 })
    await user.keyboard('plan')

    await user.keyboard('{Enter}')

    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('without an editor', () => {
  it('draws nothing', () => {
    const { container } = render(<FindBar editor={null} />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('the keys of the document', () => {
  it('step through the matches with F3 and Shift+F3, or Ctrl+G, while the bar is open', async () => {
    const { user, surface, selectionText } = await withBar()
    await user.keyboard('plan')
    act(() => {
      surface.focus()
    })

    await user.keyboard('{F3}')
    expect(status()).toHaveTextContent('1 of 4')
    await user.keyboard('{Control>}g{/Control}')
    expect(status()).toHaveTextContent('2 of 4')
    await user.keyboard('{Shift>}{F3}{/Shift}')
    expect(status()).toHaveTextContent('1 of 4')
    await user.keyboard('{Control>}{Shift>}g{/Shift}{/Control}')
    expect(status()).toHaveTextContent('4 of 4')
    expect(selectionText()).toBe('PLAN')
  })

  it('leave F3 and Escape alone while the bar is closed', async () => {
    const { user } = await openEditor()

    await user.keyboard('{F3}{Escape}')

    expect(screen.queryByRole('search', { name: 'Find and replace' })).toBeNull()
  })

  it('open the replace row with Ctrl+Alt+F as well, for a Mac, where Command+H hides the window', async () => {
    const { user } = await openEditor()

    await user.keyboard('{Control>}{Alt>}f{/Alt}{/Control}')

    expect(replaceField()).toBeInTheDocument()
  })

  it('close it with Escape from the document, leaving the document as it is', async () => {
    const { user, surface, markdown } = await withBar()
    await user.keyboard('plan')
    act(() => {
      surface.focus()
    })

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('search', { name: 'Find and replace' })).toBeNull()
    expect(markdown()).toBe(DOC)
  })
})

/** The editor with the bar open, the find field focused, and a way to read what is selected. */
async function withBar(replacing = false, source = DOC) {
  const opened = await openEditor(source)
  await opened.user.keyboard(replacing ? '{Control>}h{/Control}' : '{Control>}f{/Control}')
  const selectionText = () => {
    const editor = opened.ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('No editor.')
    const { from, to } = editor.state.selection
    return editor.state.doc.textBetween(from, to)
  }
  return { ...opened, selectionText }
}
