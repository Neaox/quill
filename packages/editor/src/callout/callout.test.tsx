import { parseDocument, serializeDocument } from '@quill/markdown'
import { CALLOUT_ICON_SHAPES } from '@quill/ui'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Editor } from '@tiptap/core'
import { undo } from '@tiptap/pm/history'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { documentFromMdast, documentToMdast } from '../document/ast.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { baseExtensions, editorSchema } from '../schema/editor-schema.ts'
import { nodeType } from '../schema/node-type.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { withCalloutViews } from './callout-view.ts'
import {
  calloutAt,
  calloutOf,
  calloutToQuote,
  quoteAt,
  quoteToCallout,
  setCalloutTitle,
  setCalloutType,
} from './callout.ts'

/**
 * Callouts in the editor: drawn as the reader draws them, switched between
 * types in the syntax the author wrote, and written back byte for byte.
 */

function stateOf(markdown: string): EditorState {
  const doc = documentFromMdast(parseDocument(markdown).ast, { softBreaks: 'collapse' }).doc
  return EditorState.create({ schema: editorSchema, doc })
}

function run(state: EditorState, command: Command): EditorState {
  let next = state
  if (!command(state, (tr) => (next = state.apply(tr)))) throw new Error('Did not apply.')
  return next
}

function markdownOf(state: EditorState): string {
  return serializeDocument({ frontMatter: {}, ast: documentToMdast(state.doc).tree })
}

describe('reading a callout', () => {
  it('knows an alert, a directive, its type and title, and an ordinary quote', () => {
    const alert = stateOf('> [!WARNING]\n> Mind.\n')
    expect(calloutAt(alert, 2)).toMatchObject({
      syntax: 'alert',
      type: 'warning',
      name: 'Warning',
      title: undefined,
      pos: 0,
    })
    const obsidian = stateOf('> [!faq] Why?\n> Because.\n')
    expect(calloutAt(obsidian, 3)).toMatchObject({
      syntax: 'alert',
      type: 'info',
      name: 'Faq',
      title: 'Why?',
    })
    expect(calloutAt(stateOf('> [!my-own-kind] Hello\n> Body.\n'), 3)).toMatchObject({
      type: 'note',
      name: 'My-own-kind',
      title: 'Hello',
    })
    const directive = stateOf(':::callout[Heads up]{type=info}\nBody.\n:::\n')
    expect(calloutAt(directive, 3)).toMatchObject({
      syntax: 'directive',
      type: 'info',
      title: 'Heads up',
    })
    // The position right before the callout finds it too.
    expect(calloutAt(directive, 0)?.pos).toBe(0)
    expect(calloutAt(stateOf('> Plain.\n'), 2)).toBeUndefined()
    expect(calloutAt(stateOf('Words.\n'), 1)).toBeUndefined()
  })

  it('reads an unknown type as a note, and an empty title as none', () => {
    const unknown = stateOf(':::callout{type=aside}\nBody.\n:::\n')
    expect(calloutAt(unknown, 2)?.type).toBe('note')
    const node = unknown.doc.child(0)
    const emptyLabel = nodeType(editorSchema, 'paragraph').create({ directiveLabel: true })
    const titled = node.copy(node.content.addToStart(emptyLabel))
    expect(calloutOf(titled, 0)).toMatchObject({ type: 'note', title: undefined })
  })

  it('finds the quote around a position, and not a callout', () => {
    expect(quoteAt(stateOf('> Plain.\n'), 2)).toBe(0)
    expect(quoteAt(stateOf('> [!NOTE]\n> Alert.\n'), 2)).toBeUndefined()
    expect(quoteAt(stateOf('> [!tip] Title\n> Alert.\n'), 3)).toBeUndefined()
    expect(quoteAt(stateOf('Words.\n'), 1)).toBeUndefined()
  })
})

describe('changing the type', () => {
  it('keeps an alert an alert, changing only the word, in its case', () => {
    expect(markdownOf(run(stateOf('> [!WARNING]\n> Mind.\n'), setCalloutType(0, 'caution')))).toBe(
      '> [!CAUTION]\n> Mind.\n',
    )
    expect(markdownOf(run(stateOf('> [!tip]\n> Mind.\n'), setCalloutType(0, 'note')))).toBe(
      '> [!note]\n> Mind.\n',
    )
  })

  it('keeps a directive’s attribute block as written', () => {
    expect(
      markdownOf(
        run(stateOf(':::callout{type=tip #keep}\nBody.\n:::\n'), setCalloutType(0, 'warning')),
      ),
    ).toBe(':::callout{type=warning #keep}\nBody.\n:::\n')
  })

  it('gives an alert any type, Info written as the quote Obsidian reads', () => {
    expect(markdownOf(run(stateOf('> [!NOTE]\n> Body.\n'), setCalloutType(0, 'info')))).toBe(
      '> [!INFO]\n> Body.\n',
    )
  })

  it('keeps an Obsidian callout’s marker and title as written, and gives the marker back', () => {
    const faq = stateOf('> [!faq] Why?\n> Because.\n')
    const warning = run(faq, setCalloutType(0, 'warning'))
    expect(markdownOf(warning)).toBe('> [!warning] Why?\n> Because.\n')
    expect(calloutAt(warning, 3)?.name).toBe('Warning')
    const back = run(warning, setCalloutType(0, 'info'))
    expect(markdownOf(back)).toBe('> [!faq] Why?\n> Because.\n')
    expect(calloutAt(back, 3)?.name).toBe('Faq')
    expect(markdownOf(run(stateOf('> [!Note]\n> Body.\n'), setCalloutType(0, 'tip')))).toBe(
      '> [!Tip]\n> Body.\n',
    )
  })

  it('keeps a kind nobody knows until it is changed', () => {
    const own = stateOf('> [!my-own-kind] Hello\n> Body.\n')
    expect(markdownOf(own)).toBe('> [!my-own-kind] Hello\n> Body.\n')
    expect(markdownOf(run(own, setCalloutType(0, 'tip')))).toBe('> [!tip] Hello\n> Body.\n')
  })

  it('does nothing for the type it already is, or where there is no callout', () => {
    expect(setCalloutType(0, 'note')(stateOf('> [!NOTE]\n> Body.\n'))).toBe(false)
    expect(setCalloutType(0, 'tip')(stateOf('Words.\n'))).toBe(false)
    expect(setCalloutType(0, 'tip')(stateOf(':::callout{type=note}\nB.\n:::\n'))).toBe(true)
  })
})

describe('the title', () => {
  it('is added, changed and removed on a callout block', () => {
    const plain = stateOf(':::callout{type=tip}\nBody.\n:::\n')
    const titled = run(plain, setCalloutTitle(0, 'Before you begin'))
    expect(markdownOf(titled)).toBe(':::callout[Before you begin]{type=tip}\nBody.\n:::\n')
    const renamed = run(titled, setCalloutTitle(0, 'Read first'))
    expect(markdownOf(renamed)).toBe(':::callout[Read first]{type=tip}\nBody.\n:::\n')
    expect(markdownOf(run(renamed, setCalloutTitle(0, ' ')))).toBe(
      ':::callout{type=tip}\nBody.\n:::\n',
    )
  })

  it('is written after an alert’s marker, as Obsidian writes it, and taken off again', () => {
    const titled = run(stateOf('> [!NOTE]\n> Body.\n'), setCalloutTitle(0, 'A title'))
    expect(markdownOf(titled)).toBe('> [!NOTE] A title\n> Body.\n')
    expect(markdownOf(run(titled, setCalloutTitle(0, '')))).toBe('> [!NOTE]\n> Body.\n')
    expect(markdownOf(run(stateOf('> [!tip] Old\n> Body.\n'), setCalloutTitle(0, 'New')))).toBe(
      '> [!tip] New\n> Body.\n',
    )
  })

  it('is refused where nothing would change, and dry-run without changing anything', () => {
    expect(setCalloutTitle(0, 'Title')(stateOf('Words.\n'))).toBe(false)
    expect(setCalloutTitle(0, '')(stateOf(':::callout{type=tip}\nBody.\n:::\n'))).toBe(false)
    expect(setCalloutTitle(0, 'New')(stateOf(':::callout{type=tip}\nBody.\n:::\n'))).toBe(true)
  })

  it('removing a title that is not there does nothing to the body', () => {
    const state = stateOf(':::callout{type=tip}\nBody.\n:::\n')
    // An empty title on a callout with none is no change at all.
    expect(setCalloutTitle(0, '')(state)).toBe(false)
  })
})

describe('quotes and callouts', () => {
  it('turns a quote into an alert, and back', () => {
    const callout = run(stateOf('> Plain words.\n'), quoteToCallout(0))
    expect(markdownOf(callout)).toBe('> [!NOTE]\n> Plain words.\n')
    expect(markdownOf(run(callout, calloutToQuote(0)))).toBe('> Plain words.\n')
  })

  it('turns a quote into an Info callout, written as Obsidian writes the kind GitHub lacks', () => {
    expect(markdownOf(run(stateOf('> Plain.\n'), quoteToCallout(0, 'info')))).toBe(
      '> [!info]\n> Plain.\n',
    )
  })

  it('turns an Obsidian callout into a quote, its title its first line', () => {
    expect(markdownOf(run(stateOf('> [!tip] Heads up\n> Body.\n'), calloutToQuote(0)))).toBe(
      '> Heads up\n>\n> Body.\n',
    )
  })

  it('turns a callout block into a quote, its title its first line', () => {
    const state = stateOf(':::callout[Heads up]{type=tip}\nBody.\n:::\n')
    expect(markdownOf(run(state, calloutToQuote(0)))).toBe('> Heads up\n>\n> Body.\n')
  })

  it('refuses what is not there to change', () => {
    expect(quoteToCallout(0)(stateOf('Words.\n'))).toBe(false)
    expect(quoteToCallout(0)(stateOf('> [!NOTE]\n> Already.\n'))).toBe(false)
    expect(calloutToQuote(0)(stateOf('Words.\n'))).toBe(false)
    expect(calloutToQuote(0)(stateOf('> [!NOTE]\n> Body.\n'))).toBe(true)
    expect(quoteToCallout(0)(stateOf('> Plain.\n'))).toBe(true)
  })
})

describe('the callout view over the other directives', () => {
  it('leaves a directive nothing else draws a plain block that holds its content', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const editor = new Editor({
      element,
      extensions: withCalloutViews(baseExtensions),
      content: stateOf(':::aside\nBody.\n:::\n\n> [!TIP]\n> Tip.\n').doc.toJSON(),
    })

    expect(element.querySelector('.callout-tip')).not.toBeNull()
    expect(element).toHaveTextContent('Body.')
    editor.destroy()
    element.remove()
  })
})

function open(markdown: string) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(markdown).ast} ref={ref} />)
  const saved = (): string => {
    const handle = ref.current
    if (handle === null) throw new Error('No handle.')
    return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
  }
  return { ...result, ref, saved, user: userEvent.setup() }
}

describe('a callout in the editor', () => {
  it('is drawn as the reader draws it, with no marker text, and passes axe', async () => {
    const { container } = open('> [!IMPORTANT]\n> Crucial information.\n')
    const callout = screen.getByRole('group', { name: 'Important callout' })
    expect(callout).toHaveClass('callout', 'callout-important')
    expect(callout).toHaveAttribute('data-syntax', 'alert')
    expect(callout).not.toHaveTextContent('[!IMPORTANT]')
    expect(within(callout).getByRole('button', { name: 'Important, change type' })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    )
    await expectNoAccessibilityViolations(container)
  })

  it('switches type from its own button, as one undo step, keeping the syntax', async () => {
    const { user, saved, ref } = open('> [!WARNING]\n> Mind the gap.\n')
    await user.click(screen.getByRole('button', { name: 'Warning, change type' }))
    const menu = await screen.findByRole('menu', { name: 'Callout type' })
    const info = within(menu).getByRole('menuitemradio', { name: 'Info' })
    expect(info).not.toHaveAttribute('data-disabled')
    // Each kind wears the reader's own mark: the caution octagon, not a generic sign.
    const caution = within(menu).getByRole('menuitemradio', { name: 'Caution' })
    const [octagon] = CALLOUT_ICON_SHAPES.caution
    expect(caution.querySelector('svg path')?.getAttribute('d')).toBe(
      octagon?.tag === 'path' ? octagon.d : undefined,
    )
    await user.click(caution)
    expect(saved()).toBe('> [!CAUTION]\n> Mind the gap.\n')
    expect(screen.getByRole('group', { name: 'Caution callout' })).toHaveClass('callout-caution')
    act(() => {
      const editor = ref.current?.editor
      if (editor !== null && editor !== undefined) undo(editor.state, editor.view.dispatch)
    })
    expect(saved()).toBe('> [!WARNING]\n> Mind the gap.\n')
  })

  it('gives the keyboard back to its button when its menu is put away', async () => {
    const { user } = open('> [!WARNING]\n> Mind the gap.\n')
    const button = screen.getByRole('button', { name: 'Warning, change type' })
    await user.click(button)
    await screen.findByRole('menu', { name: 'Callout type' })

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu', { name: 'Callout type' })).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('switches a callout block, and gives it a title', async () => {
    const { user, saved } = open(':::callout{type=tip}\nBody.\n:::\n')
    await user.click(screen.getByRole('button', { name: 'Tip, change type' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Info' }))
    expect(saved()).toBe(':::callout{type=info}\nBody.\n:::\n')
    await user.click(screen.getByRole('button', { name: 'Info, change type' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Add title' }))
    expect(saved()).toBe(':::callout[Title]{type=info}\nBody.\n:::\n')
    await user.keyboard('Read first')
    expect(saved()).toBe(':::callout[Read first]{type=info}\nBody.\n:::\n')
    await user.click(screen.getByRole('button', { name: 'Info, change type' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove title' }))
    expect(saved()).toBe(':::callout{type=info}\nBody.\n:::\n')
  })

  it('becomes a plain quote from its switcher', async () => {
    const { user, saved } = open('> [!NOTE]\n> Body.\n')
    await user.click(screen.getByRole('button', { name: 'Note, change type' }))
    const menu = await screen.findByRole('menu', { name: 'Callout type' })
    await user.click(within(menu).getByRole('menuitem', { name: 'Turn into a plain quote' }))
    expect(saved()).toBe('> Body.\n')
    expect(screen.queryByRole('group', { name: /callout/ })).not.toBeInTheDocument()
  })

  it('gives an alert a title from its switcher, written after its marker', async () => {
    const { user, saved } = open('> [!IMPORTANT]\n> Delete every mark.\n')
    await user.click(screen.getByRole('button', { name: 'Important, change type' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Add title' }))
    await user.keyboard('Read this')
    expect(saved()).toBe('> [!IMPORTANT] Read this\n> Delete every mark.\n')
  })

  it('shows an Obsidian callout’s title, and a kind of the author’s own, and passes axe', async () => {
    const { container } = open(
      '> [!my-own-kind] Hello\n> Body.\n\n> [!tip] Custom title\n> Body.\n',
    )
    const own = screen.getByRole('group', { name: 'My-own-kind callout' })
    expect(own).toHaveClass('callout', 'callout-note')
    expect(own).toHaveTextContent('Hello')
    expect(own).not.toHaveTextContent('[!my-own-kind]')
    expect(within(own).getByRole('button', { name: 'My-own-kind, change type' })).toBeVisible()
    const tip = screen.getByRole('group', { name: 'Tip callout' })
    expect(tip).toHaveTextContent('Custom title')
    await expectNoAccessibilityViolations(container)
  })

  it('switches an Obsidian callout’s type keeping how it was written', async () => {
    const { user, saved } = open('> [!faq] Why?\n> Because.\n')
    await user.click(screen.getByRole('button', { name: 'Faq, change type' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Warning' }))
    expect(saved()).toBe('> [!warning] Why?\n> Because.\n')
    await user.click(screen.getByRole('button', { name: 'Warning, change type' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Info' }))
    expect(saved()).toBe('> [!faq] Why?\n> Because.\n')
  })

  it('keeps a quote a quote until it is made a callout', () => {
    const { container } = open('> Plain.\n')
    expect(container.querySelector('blockquote')).not.toBeNull()
    expect(screen.queryByRole('group', { name: /callout/ })).not.toBeInTheDocument()
  })

  it('draws a callout in a read-only editor too, with nowhere for its button to go', async () => {
    const ref = createRef<DocumentEditorHandle>()
    render(
      <DocumentEditor ast={parseDocument('> [!TIP]\n> Body.\n').ast} ref={ref} editable={false} />,
    )
    const button = screen.getByRole('button', { name: 'Tip, change type' })
    await userEvent.click(button)
    expect(screen.getByRole('group', { name: 'Tip callout' })).toBeInTheDocument()
  })

  it('redraws when its type changes underneath it, and rebuilds when it stops being one', () => {
    const { ref, saved } = open('> [!NOTE]\n> Body.\n')
    const editor = ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('No editor.')
    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'attributes', { type: 'tip' }))
    })
    expect(screen.getByRole('group', { name: 'Tip callout' })).toBeInTheDocument()
    act(() => {
      // Written as a directive from here on: the same callout, drawn anew.
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'alert', null))
    })
    expect(screen.getByRole('group', { name: 'Tip callout' })).toHaveAttribute(
      'data-syntax',
      'directive',
    )
    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'name', 'aside'))
    })
    expect(screen.queryByRole('group', { name: /callout/ })).not.toBeInTheDocument()
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)).insertText('x'),
      )
    })
    expect(saved()).toContain('x')
  })
})
