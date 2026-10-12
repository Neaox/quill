import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { markType } from '../schema/node-type.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { isExternal, normaliseHref } from './href.ts'
import { applyLink, linkAt, unlink } from './links.ts'
import {
  clearFormatting,
  describeKey,
  describeShortcut,
  INLINE_MARKS,
  isMarkActive,
  toggleInlineMark,
} from './marks.ts'
import { activeTextStyle, TEXT_STYLES, toggleTextStyle } from './text-styles.ts'
import { inSequence, transactionOf } from './transactions.ts'

const harness = createEditorTestHarness()

function stateAt(markdown: string, from: number, to = from): EditorState {
  const opened = harness.state(markdown)
  return opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, from, to)))
}

/** A caret one character into the first text that contains `needle`. */
function caretIn(markdown: string, needle: string): EditorState {
  const { doc } = harness.state(markdown)
  let found = -1
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(needle) === true) found = pos + 1
  })
  return stateAt(markdown, found)
}

function markdownOf(state: EditorState): string {
  return harness.read(documentToMdast(state.doc).tree)
}

/** Applies a command and returns the Markdown it leaves, or null when it declined. */
function run(command: Command, state: EditorState): string | null {
  const tr = transactionOf(command, state)
  return tr === null ? null : markdownOf(state.apply(tr))
}

function style(id: string) {
  const found = TEXT_STYLES.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`There is no "${id}" style.`)
  return found
}

describe('normalising a link address', () => {
  it.each([
    ['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'],
    ['http://example.com', 'http://example.com'],
    ['  https://example.com  ', 'https://example.com'],
    ['mailto:a@b.co', 'mailto:a@b.co'],
    ['/docs/intro', '/docs/intro'],
    ['#section', '#section'],
    ['./sibling', './sibling'],
    ['../parent', '../parent'],
    ['?q=1', '?q=1'],
    ['example.com', 'https://example.com'],
    ['example.com/path?x=1', 'https://example.com/path?x=1'],
    ['ada@example.com', 'mailto:ada@example.com'],
  ])('accepts %j as %j', (typed, stored) => {
    expect(normaliseHref(typed)).toBe(stored)
  })

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>',
    'vbscript:x',
    'file:///etc/passwd',
    '//evil.example/x',
    'two words',
    'intro',
    'https://exa mple.com',
  ])('refuses %j', (typed) => {
    expect(normaliseHref(typed)).toBeNull()
  })

  it('knows which addresses leave the document', () => {
    expect(isExternal('https://example.com')).toBe(true)
    expect(isExternal('HTTP://example.com')).toBe(true)
    expect(isExternal('/docs')).toBe(false)
    expect(isExternal('mailto:a@b.co')).toBe(false)
  })
})

describe('the inline marks', () => {
  it('toggles each one on a selection, and off again', () => {
    for (const mark of INLINE_MARKS) {
      const on = stateAt('word\n', 1, 5)
      const marked = on.apply(transactionOf(toggleInlineMark(mark.name), on) ?? on.tr)
      expect(isMarkActive(marked, mark.name)).toBe(true)
      const off = marked.apply(transactionOf(toggleInlineMark(mark.name), marked) ?? marked.tr)
      expect(isMarkActive(off, mark.name)).toBe(false)
    }
  })

  it('reads the mark a caret would type with', () => {
    expect(isMarkActive(stateAt('**bold** plain\n', 3), 'bold')).toBe(true)
    expect(isMarkActive(stateAt('**bold** plain\n', 9), 'bold')).toBe(false)
    const stored = stateAt('plain\n', 3)
    const typing = stored.apply(stored.tr.addStoredMark(markType(stored.schema, 'italic').create()))
    expect(isMarkActive(typing, 'italic')).toBe(true)
  })

  it('describes a binding the way the platform writes it', () => {
    expect(describeKey('Mod-b', 'MacIntel')).toBe('⌘B')
    expect(describeKey('Mod-Shift-x', 'MacIntel')).toBe('⌘⇧X')
    expect(describeKey('Mod-b', 'Win32')).toBe('Ctrl+B')
    expect(describeKey('Mod-Alt-1', 'Linux x86_64')).toBe('Ctrl+Alt+1')
    expect(describeKey('Mod-Alt-1', 'iPhone')).toBe('⌘⌥1')
  })

  it('leaves a key that is not a single letter as it is written', () => {
    expect(describeKey('Shift-Enter', 'Win32')).toBe('Shift+Enter')
    expect(describeKey('Alt-F10', 'MacIntel')).toBe('⌥F10')
    // The arrows are drawn as arrows, which is shorter than their names and what the keys show.
    expect(describeKey('Alt-Shift-ArrowUp', 'Win32')).toBe('Alt+Shift+↑')
    expect(describeKey('Mod-Alt-ArrowLeft', 'MacIntel')).toBe('⌘⌥←')
  })

  it('describes a key for the browser it is running in', () => {
    expect(describeShortcut('Mod-b')).toBe(describeKey('Mod-b', navigator.platform))
  })

  it('binds every mark to a key the toolbar can show', () => {
    expect(INLINE_MARKS.map((mark) => mark.key)).toEqual(['Mod-b', 'Mod-i', 'Mod-Shift-x', 'Mod-e'])
  })
})

describe('links under the caret', () => {
  const source = 'Read [the docs](https://example.com) now.\n'
  // "Read " is 5 characters, so the link text starts at position 6 and ends at 14.

  it('finds the whole link from a caret inside it', () => {
    expect(linkAt(stateAt(source, 9))).toEqual({
      from: 6,
      to: 14,
      href: 'https://example.com',
      title: null,
    })
  })

  it('finds it from a selection inside it, and not from one that spills out', () => {
    expect(linkAt(stateAt(source, 7, 10))?.href).toBe('https://example.com')
    expect(linkAt(stateAt(source, 3, 10))).toBeNull()
  })

  it('treats either end as outside, because typing there would not extend it', () => {
    expect(linkAt(stateAt(source, 6))).toBeNull()
    expect(linkAt(stateAt(source, 14))).toBeNull()
    expect(linkAt(stateAt(source, 2))).toBeNull()
  })

  it('joins neighbouring text that shares one address into one link', () => {
    const state = stateAt('[a **b**](https://example.com)\n', 2)
    expect(linkAt(state)).toMatchObject({ from: 1, to: 4 })
  })

  it('keeps links that go to different places apart', () => {
    const state = stateAt('[a](/one)[b](/two)\n', 1)
    expect(linkAt(stateAt('[a](/one)[bb](/two)\n', 3))).toMatchObject({
      href: '/two',
      from: 2,
      to: 4,
    })
    expect(state.selection.empty).toBe(true)
  })

  it('reads a link with no address as an empty one, rather than failing', () => {
    const opened = harness.state('Some words\n')
    const type = markType(opened.schema, 'link')
    const linked = opened.apply(opened.tr.addMark(1, 5, type.create({})))
    const inside = linked.apply(linked.tr.setSelection(TextSelection.create(linked.doc, 3)))
    expect(linkAt(inside)).toEqual({ from: 1, to: 5, href: '', title: null })
  })

  it('reports a title when the link has one', () => {
    expect(linkAt(stateAt('[a b](/x "Tip")\n', 2))?.title).toBe('Tip')
  })

  it('changes where a link points, from the caret or from a selection', () => {
    expect(run(applyLink('/new'), stateAt(source, 9))).toBe('Read [the docs](/new) now.\n')
    expect(run(applyLink('/new'), stateAt('plain words\n', 1, 6))).toBe('[plain](/new) words\n')
  })

  it('declines to link a caret that is not in a link', () => {
    expect(run(applyLink('/new'), stateAt('plain words\n', 3))).toBeNull()
  })

  it('removes a link from the caret or from a selection', () => {
    expect(run(unlink, stateAt(source, 9))).toBe('Read the docs now.\n')
    expect(run(unlink, stateAt(source, 6, 14))).toBe('Read the docs now.\n')
    expect(run(unlink, stateAt('plain words\n', 3))).toBeNull()
  })
})

describe('turning a block into a style', () => {
  it('makes a heading, a quote, a code block and a list out of a paragraph', () => {
    const at = (id: string) => run(style(id).command, stateAt('Some words\n', 3))
    expect(at('heading-1')).toBe('# Some words\n')
    expect(at('heading-4')).toBe('#### Some words\n')
    expect(at('blockquote')).toBe('> Some words\n')
    expect(at('code-block')).toBe('```\nSome words\n```\n')
    expect(at('bullet-list')).toBe('- Some words\n')
    expect(at('ordered-list')).toBe('1. Some words\n')
    expect(at('task-list')).toBe('- [ ] Some words\n')
  })

  it('sets a style rather than toggling it, so choosing it twice changes nothing more', () => {
    expect(run(style('heading-2').command, stateAt('## Same\n', 3))?.trim()).toBe('## Same')
    expect(run(style('bullet-list').command, stateAt('- Same\n', 3))).toBeNull()
    expect(run(style('blockquote').command, stateAt('> Same\n', 3))).toBeNull()
  })

  it('returns to plain text out of a heading, a list item and a quote', () => {
    const plain = style('paragraph').command
    expect(run(plain, stateAt('## Title\n', 3))).toBe('Title\n')
    expect(run(plain, stateAt('- One\n', 3))).toBe('One\n')
    expect(run(plain, stateAt('> Quoted\n', 3))).toBe('Quoted\n')
  })

  it('leaves a nested list entirely, not one level at a time', () => {
    expect(run(style('paragraph').command, caretIn('- One\n  - Two\n', 'Two'))).toBe(
      '- One\n\nTwo\n',
    )
  })

  it('makes a heading out of a list item, which has to leave the list to be one', () => {
    expect(run(style('heading-2').command, stateAt('- One\n', 3))).toBe('## One\n')
  })

  it('changes one kind of list into another in a single step', () => {
    const before = stateAt('- One\n- Two\n', 3)
    const tr = transactionOf(style('ordered-list').command, before)
    expect(tr).not.toBeNull()
    expect(markdownOf(before.apply(tr ?? before.tr))).toContain('1. One')
    expect(run(style('task-list').command, stateAt('1. One\n', 4))).toContain('[ ] One')
  })

  it('declines to make a list of something that cannot be in one', () => {
    const opened = harness.state('---\n\nText.\n')
    const rule = opened.apply(opened.tr.setSelection(NodeSelection.create(opened.doc, 0)))
    expect(transactionOf(style('bullet-list').command, rule)).toBeNull()
  })

  it('puts a list inside a quote ahead of the quote, and a heading ahead of both', () => {
    const inQuote = activeTextStyle(caretIn('> - Item\n', 'Item'))
    expect(inQuote?.id).toBe('bullet-list')
  })

  it('puts a heading ahead of the quote it is in', () => {
    expect(activeTextStyle(caretIn('> ## Quoted heading\n', 'Quoted'))?.id).toBe('heading-2')
  })

  it('says which style the caret is in, most specific first', () => {
    const at = (markdown: string, pos: number) => activeTextStyle(stateAt(markdown, pos))?.id
    expect(at('Plain\n', 2)).toBe('paragraph')
    expect(at('## Title\n', 3)).toBe('heading-2')
    expect(at('- Item\n', 3)).toBe('bullet-list')
    expect(at('1. Item\n', 4)).toBe('ordered-list')
    expect(at('- [ ] Item\n', 4)).toBe('task-list')
    expect(at('> Quote\n', 3)).toBe('blockquote')
    expect(at('```\ncode\n```\n', 3)).toBe('code-block')
  })

  it('offers each style a unique id and a label', () => {
    expect(new Set(TEXT_STYLES.map((each) => each.id)).size).toBe(TEXT_STYLES.length)
    expect(TEXT_STYLES.every((each) => each.label.length > 0 && each.description.length > 0)).toBe(
      true,
    )
  })
})

describe('turning a style on and off', () => {
  it('turns a list on, and off again, as the one button or key', () => {
    const on = run(toggleTextStyle(style('bullet-list')), caretIn('One.\n', 'One'))
    expect(on).toBe('- One.\n')

    const opened = caretIn('- One.\n', 'One')
    expect(run(toggleTextStyle(style('bullet-list')), opened)).toBe('One.\n')
  })

  it('turns a quote on and off', () => {
    expect(run(toggleTextStyle(style('blockquote')), caretIn('One.\n', 'One'))).toBe('> One.\n')
    expect(run(toggleTextStyle(style('blockquote')), caretIn('> One.\n', 'One'))).toBe('One.\n')
  })

  it('turns one kind of list into another, rather than off', () => {
    expect(run(toggleTextStyle(style('ordered-list')), caretIn('- One.\n', 'One'))).toBe(
      '1. One.\n',
    )
  })

  it('leaves a style that is a choice as one: made, and made again, is the same', () => {
    expect(run(toggleTextStyle(style('heading-2')), caretIn('One.\n', 'One'))).toBe('## One.\n')
    expect(run(toggleTextStyle(style('heading-2')), caretIn('## One.\n', 'One'))).toBe('## One.\n')
  })
})

describe('clearing formatting', () => {
  it('takes the marks off the selection, and leaves the words and any link', () => {
    const source = 'Some **bold _and italic_** and [a link](/x) and `code`.\n'
    const state = stateAt(source, 1, 1 + (harness.state(source).doc.firstChild?.content.size ?? 0))

    expect(run(clearFormatting, state)).toBe('Some bold and italic and [a link](/x) and code.\n')
  })

  it('clears what the next typed character would be, for a caret', () => {
    const state = caretIn('Some **bold** text.\n', 'bold')
    const bold = state.apply(state.tr.setStoredMarks([markType(state.schema, 'bold').create()]))

    const cleared = transactionOf(clearFormatting, bold)

    expect(cleared && bold.apply(cleared).storedMarks).toEqual([])
  })

  it('declines a selection with nothing to clear', () => {
    expect(run(clearFormatting, stateAt('Plain words.\n', 1, 6))).toBeNull()
    expect(run(clearFormatting, stateAt('Plain words.\n', 3))).toBeNull()
  })
})

describe('commands in sequence', () => {
  it("joins what each did into one transaction, each seeing the last one's document", () => {
    const state = stateAt('One two\n', 1, 4)
    const tr = inSequence(state, [
      () => toggleInlineMark('bold'),
      (current) =>
        current.doc.textContent === 'One two' ? toggleInlineMark('italic') : () => false,
    ])
    expect(tr).not.toBeNull()
    expect(markdownOf(state.apply(tr ?? state.tr))).toBe('***One*** two\n')
  })

  it('treats a command that applies without dispatching as having built nothing', () => {
    const state = stateAt('One\n', 1)
    expect(transactionOf(() => true, state)).toBeNull()
  })

  it('skips a command that does not apply, and says so when none did', () => {
    const state = stateAt('One\n', 1)
    expect(inSequence(state, [() => () => false])).toBeNull()
    expect(inSequence(state, [])).toBeNull()
    expect(transactionOf(() => false, state)).toBeNull()
  })
})
