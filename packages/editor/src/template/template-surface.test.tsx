import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { placeholderAt, placeholderTypingKey } from './placeholder-typing.ts'
import { requiredDecorations, requiredHeadings } from './required-markers.ts'

const TEMPLATE = [
  '---',
  'template:',
  '  name: Architecture decision record',
  '  version: 3',
  '  sections:',
  '    - heading: Context',
  '      required: true',
  '    - heading: Alternatives considered',
  '      optional: true',
  '---',
  '',
  ':::guidance',
  'Keep the context to what a reader in a year needs.',
  ':::',
  '',
  '## Context',
  '',
  ':::placeholder',
  'What constraints shaped the decision?',
  ':::',
  '',
  ':::optional{title="Alternatives considered"}',
  'What else was possible.',
  ':::',
  '',
  ':::callout{type="warning"}',
  'Mind the gap.',
  ':::',
  '',
  ':::timeline',
  'Something this editor has never heard of.',
  ':::',
  '',
].join('\n')

function open(source = TEMPLATE) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  return { ref, user: userEvent.setup(), ...result }
}

function markdown(ref: { current: DocumentEditorHandle | null }): string {
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

describe('the template surface', () => {
  it('shows guidance as a dismissible hint card', async () => {
    const { user, ref } = open()
    const card = screen.getByRole('note', { name: 'Guidance' })
    expect(card).toBeVisible()
    expect(card).not.toHaveAttribute('data-dismissed')

    await user.click(screen.getByRole('button', { name: 'Dismiss guidance' }))
    expect(screen.getByRole('note', { name: 'Guidance' })).toHaveAttribute('data-dismissed', 'true')
    expect(screen.queryByRole('button', { name: 'Dismiss guidance' })).not.toBeInTheDocument()
    // Dismissing changes the view, not the document.
    expect(markdown(ref)).toContain(':::guidance')
  })

  it('shows an optional section as an offer rather than as content', async () => {
    const { user, ref } = open()
    const offer = screen.getByRole('button', { name: 'Add section: Alternatives considered' })
    expect(offer).toBeVisible()

    await user.click(offer)
    expect(markdown(ref)).toContain('added')
    expect(
      screen.queryByRole('button', { name: 'Add section: Alternatives considered' }),
    ).not.toBeInTheDocument()
  })

  it('names a callout by the tone it carries', () => {
    open()
    expect(screen.getByRole('group', { name: 'Callout: warning' })).toBeVisible()
  })

  it('renders the template surface without an accessibility violation', async () => {
    const { container } = open()
    await expectNoAccessibilityViolations(container)
  })

  it('shows a directive it has never heard of as itself, rather than dropping it', () => {
    const { ref } = open()
    expect(document.querySelector('.directive-timeline')).not.toBeNull()
    expect(markdown(ref)).toContain(':::timeline')
  })

  it('marks a required section beside its heading, in words as well as a dot', () => {
    open()
    const marker = document.querySelector('.required-section-marker')
    expect(marker?.textContent).toContain('(required section)')
    expect(document.querySelector('[data-required-section="true"]')).not.toBeNull()
  })

  it('replaces a placeholder with what the author types into it', () => {
    const { ref } = open()
    const editor = ref.current?.editor
    if (editor === undefined || editor === null) throw new Error('There is no editor.')

    let inside = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs['name'] === 'placeholder') inside = pos + 2
    })
    expect(inside).toBeGreaterThan(0)

    const plugin = placeholderTypingKey.get(editor.state)
    if (plugin === undefined) throw new Error('The placeholder plugin is not installed.')
    act(() => {
      editor.commands.setTextSelection(inside)
      const handled = plugin.props.handleTextInput?.call(
        plugin,
        editor.view,
        inside,
        inside,
        'Latency',
        () => editor.state.tr,
      )
      expect(handled).toBe(true)
    })

    expect(markdown(ref)).not.toContain(':::placeholder')
    expect(markdown(ref)).toContain('Latency')
  })
})

describe('finding the placeholder a position is inside', () => {
  const harness = createEditorTestHarness()

  it('finds a block placeholder, and says it is a block', () => {
    const state = harness.state(':::placeholder\nSay something.\n:::\n')
    expect(placeholderAt(state.doc.resolve(3))).toEqual({ from: 0, to: 18, block: true })
  })

  it('finds an inline placeholder, and says it is not a block', () => {
    const state = harness.state('Before :placeholder[a phrase] after.\n')
    const found = placeholderAt(state.doc.resolve(10))
    expect(found?.block).toBe(false)
  })

  it('finds nothing where there is no placeholder', () => {
    const state = harness.state('Just prose.\n')
    expect(placeholderAt(state.doc.resolve(2))).toBeNull()
  })

  it('ignores a directive that merely happens to be nearby', () => {
    const state = harness.state(':::guidance\nAdvice.\n:::\n')
    expect(placeholderAt(state.doc.resolve(3))).toBeNull()
  })
})

describe('the required-section decorations', () => {
  const harness = createEditorTestHarness()

  it('has nothing to mark in a document with no template', () => {
    const { doc } = harness.state('# A heading\n')
    expect(requiredHeadings(doc).size).toBe(0)
    expect(requiredDecorations(doc).find()).toEqual([])
  })

  it('has nothing to mark when the front matter declares no template', () => {
    const { doc } = harness.state('---\ntitle: A\n---\n\n# A heading\n')
    expect(requiredHeadings(doc).size).toBe(0)
  })

  it('marks only the headings the template requires', () => {
    const { doc } = harness.state(TEMPLATE)
    expect([...requiredHeadings(doc)]).toEqual(['Context'])
    expect(requiredDecorations(doc).find().length).toBe(2)
  })

  it('computes the decorations for a document only once', () => {
    const { doc } = harness.state(TEMPLATE)
    expect(requiredDecorations(doc)).toBe(requiredDecorations(doc))
  })
})

describe('an inline placeholder written over', () => {
  it('becomes the words themselves, inside the sentence around it', () => {
    const ref = createRef<DocumentEditorHandle>()
    render(
      <DocumentEditor
        ast={parseDocument('Before :placeholder[a phrase] after.\n').ast}
        ref={ref}
      />,
    )
    const editor = ref.current?.editor
    if (editor === undefined || editor === null) throw new Error('There is no editor.')

    let inside = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs['name'] === 'placeholder') inside = pos + 1
    })
    const plugin = placeholderTypingKey.get(editor.state)
    if (plugin === undefined) throw new Error('The placeholder plugin is not installed.')

    act(() => {
      editor.commands.setTextSelection(inside)
      plugin.props.handleTextInput?.call(
        plugin,
        editor.view,
        inside,
        inside,
        'these words',
        () => editor.state.tr,
      )
    })

    const handle = ref.current
    if (handle === null) throw new Error('The editor did not expose a handle.')
    expect(serializeDocument({ frontMatter: {}, ast: handle.toMdast() })).toBe(
      'Before these words after.\n',
    )
  })
})
