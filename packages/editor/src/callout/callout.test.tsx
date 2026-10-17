import { parseDocument, serializeDocument } from '@quill/markdown'
import { CALLOUT_ICON_SHAPES } from '@quill/ui'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { undo } from '@tiptap/pm/history'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { documentFromMdast, documentToMdast } from '../document/ast.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { editorSchema } from '../schema/editor-schema.ts'
import { nodeType } from '../schema/node-type.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import {
  ALERT_LIMITS,
  calloutAt,
  calloutOf,
  calloutToQuote,
  quoteAt,
  quoteToCallout,
  setCalloutTitle,
  setCalloutType,
  typeUnavailable,
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
    expect(calloutAt(alert, 2)).toMatchObject({ syntax: 'alert', type: 'warning', pos: 0 })
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

  it('offers an alert no Info, and says why', () => {
    const alert = stateOf('> [!NOTE]\n> Body.\n')
    const callout = calloutAt(alert, 2)
    if (callout === undefined) throw new Error('Expected a callout.')
    expect(typeUnavailable(callout, 'info')).toBe(ALERT_LIMITS.info)
    expect(typeUnavailable(callout, 'tip')).toBeUndefined()
    expect(setCalloutType(0, 'info')(alert)).toBe(false)
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

  it('is refused on an alert, unchanged, and dry-run without changing anything', () => {
    expect(setCalloutTitle(0, 'Title')(stateOf('> [!NOTE]\n> Body.\n'))).toBe(false)
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

  it('turns a callout block into a quote, its title its first line', () => {
    const state = stateOf(':::callout[Heads up]{type=tip}\nBody.\n:::\n')
    expect(markdownOf(run(state, calloutToQuote(0)))).toBe('> Heads up\n>\n> Body.\n')
  })

  it('refuses what is not there to change', () => {
    expect(quoteToCallout(0)(stateOf('Words.\n'))).toBe(false)
    expect(quoteToCallout(0)(stateOf('> [!NOTE]\n> Already.\n'))).toBe(false)
    expect(quoteToCallout(0, 'info')(stateOf('> Plain.\n'))).toBe(false)
    expect(calloutToQuote(0)(stateOf('Words.\n'))).toBe(false)
    expect(calloutToQuote(0)(stateOf('> [!NOTE]\n> Body.\n'))).toBe(true)
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
    const info = within(menu).getByRole('menuitemradio', { name: /Info/ })
    expect(info).toHaveAttribute('data-disabled')
    expect(info).toHaveTextContent(ALERT_LIMITS.info)
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
    expect(within(menu).getByRole('menuitem', { name: /Add title/ })).toHaveAttribute(
      'data-disabled',
    )
    await user.click(within(menu).getByRole('menuitem', { name: 'Turn into a plain quote' }))
    expect(saved()).toBe('> Body.\n')
    expect(screen.queryByRole('group', { name: /callout/ })).not.toBeInTheDocument()
  })

  it('keeps a quote a quote until it is made a callout', () => {
    const { container } = open('> Plain.\n')
    expect(container.querySelector('blockquote.blockquote')).not.toBeNull()
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
    const { ref } = open('> [!NOTE]\n> Body.\n')
    const editor = ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('No editor.')
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setNodeAttribute(0, 'alert', { marker: '[!TIP]\n', alone: false }),
      )
    })
    expect(screen.getByRole('group', { name: 'Tip callout' })).toBeInTheDocument()
    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'alert', null))
    })
    expect(screen.queryByRole('group', { name: /callout/ })).not.toBeInTheDocument()
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)).insertText('x'),
      )
    })
    expect(document.querySelector('blockquote.blockquote')).not.toBeNull()
  })
})
