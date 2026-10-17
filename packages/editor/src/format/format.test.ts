import { parseDocument, serializeDocument } from '@quill/markdown'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentFromMdast, documentToMdast } from '../document/ast.ts'
import { editorSchema } from '../schema/editor-schema.ts'
import {
  clearFormatting,
  directiveActive,
  hasFormatting,
  markActive,
  toggleFormatDirective,
  toggleFormatMark,
} from './format-commands.ts'
import { SHORTCUTS, isApplePlatform, shortcutFor, shortcutLabel } from './shortcuts.ts'
import { TURN_INTO, TURN_INTO_LABELS, currentKind, sequence, turnInto } from './turn-into.ts'

/** A state over Markdown, with the selection on the first occurrence of `words` (or a caret before `|`). */
function stateOf(markdown: string, words?: string): EditorState {
  const doc = documentFromMdast(parseDocument(markdown).ast, { softBreaks: 'collapse' }).doc
  const state = EditorState.create({ schema: editorSchema, doc })
  if (words === undefined) return state
  let found: { from: number; to: number } | undefined
  doc.descendants((node, pos) => {
    if (found !== undefined || !node.isText) return found === undefined
    const at = node.text?.indexOf(words) ?? -1
    if (at >= 0) found = { from: pos + at, to: pos + at + words.length }
    return false
  })
  if (found === undefined) throw new Error(`"${words}" is not in the document.`)
  return state.apply(state.tr.setSelection(TextSelection.create(doc, found.from, found.to)))
}

function caretIn(markdown: string, words: string): EditorState {
  const state = stateOf(markdown, words)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.selection.from)))
}

function run(state: EditorState, command: Command): EditorState {
  let next = state
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  if (!applied) throw new Error('The command did not apply.')
  return next
}

function markdownOf(state: EditorState): string {
  return serializeDocument({ frontMatter: {}, ast: documentToMdast(state.doc).tree })
}

describe('marks', () => {
  it('toggle on and off across the selection, reporting whether all of it carries them', () => {
    const state = stateOf('Make this bold.\n', 'this')
    expect(markActive(state, 'bold')).toBe(false)
    const bold = run(state, toggleFormatMark('bold'))
    expect(markdownOf(bold)).toBe('Make **this** bold.\n')
    expect(markActive(bold, 'bold')).toBe(true)
    expect(markdownOf(run(bold, toggleFormatMark('bold')))).toBe('Make this bold.\n')
  })

  it('are partly active when only some of the selection carries them, which reads as off', () => {
    const state = stateOf('Some **bold** words.\n')
    // From the start of "bold" to the end of "words".
    const partly = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6, 16)))
    expect(markActive(partly, 'bold')).toBe(false)
  })

  it('at a caret, say what typing would carry', () => {
    expect(markActive(caretIn('Some *slanted* words.\n', 'lanted'), 'italic')).toBe(true)
    expect(markActive(caretIn('Plain words.\n', 'words'), 'italic')).toBe(false)
  })

  it('say nothing is marked in a selection with no text in it', () => {
    const state = stateOf('Words.\n\n---\n')
    const rule = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 8)))
    expect(markActive(rule, 'bold')).toBe(false)
  })

  it('cover strikethrough and inline code', () => {
    expect(markdownOf(run(stateOf('Old words.\n', 'Old'), toggleFormatMark('strike')))).toBe(
      '~~Old~~ words.\n',
    )
    expect(markdownOf(run(stateOf('Run npm now.\n', 'npm'), toggleFormatMark('code')))).toBe(
      'Run `npm` now.\n',
    )
  })
})

describe('small print and badges', () => {
  it('wrap the selected words, which stay selected', () => {
    const small = run(
      stateOf('Drawn from main today.\n', 'from main'),
      toggleFormatDirective('small'),
    )
    expect(markdownOf(small)).toBe('Drawn :small[from main] today.\n')
    expect(small.doc.textBetween(small.selection.from, small.selection.to)).toBe('from main')
    expect(directiveActive(small, 'small')).toBe(true)
  })

  it('unwrap when the selection is already inside one', () => {
    const state = stateOf('Status :badge[Built] today.\n', 'Built')
    expect(directiveActive(state, 'badge')).toBe(true)
    const plain = run(state, toggleFormatDirective('badge'))
    expect(markdownOf(plain)).toBe('Status Built today.\n')
  })

  it('keep formatting inside what they wrap', () => {
    expect(
      markdownOf(run(stateOf('A **bold** word.\n', 'bold'), toggleFormatDirective('badge'))),
    ).toBe('A :badge[**bold**] word.\n')
  })

  it('do nothing at a caret, across two lines, or in code', () => {
    const caret = caretIn('Words.\n', 'ords')
    expect(toggleFormatDirective('small')(caret)).toBe(false)
    const two = stateOf('One.\n\nTwo.\n')
    const across = two.apply(two.tr.setSelection(TextSelection.create(two.doc, 2, 9)))
    expect(toggleFormatDirective('small')(across)).toBe(false)
    expect(toggleFormatDirective('small')(stateOf('```\ncode here\n```\n', 'code'))).toBe(false)
  })

  it('is not active across the edge of one', () => {
    expect(
      directiveActive(stateOf('A :small[quiet] word.\n', 'quiet] w'.slice(0, 5)), 'small'),
    ).toBe(true)
    expect(directiveActive(stateOf('A :small[quiet] and loud.\n', 'and'), 'small')).toBe(false)
  })
})

describe('clearing formatting', () => {
  it('takes off marks, small print and badges, but keeps links', () => {
    const source = 'A **bold** *it* :small[quiet] :badge[Built] [link](https://example.com) end.\n'
    const state = stateOf(source)
    const all = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
    )
    expect(hasFormatting(all)).toBe(true)
    const cleared = run(all, clearFormatting)
    expect(markdownOf(cleared)).toBe('A bold it quiet Built [link](https://example.com) end.\n')
    expect(cleared.selection.empty).toBe(false)
  })

  it('unwraps the small print the selection is inside', () => {
    const cleared = run(stateOf('A :small[quiet words] here.\n', 'quiet'), clearFormatting)
    expect(markdownOf(cleared)).toBe('A quiet words here.\n')
  })

  it('has nothing to do on plain words or at a caret', () => {
    expect(clearFormatting(stateOf('Plain words.\n', 'Plain'))).toBe(false)
    expect(hasFormatting(caretIn('A **bold** word.\n', 'old'))).toBe(false)
  })
})

describe('turning a block into another', () => {
  it('knows what the caret’s block is now', () => {
    expect(currentKind(caretIn('Words.\n', 'ords'))).toBe('paragraph')
    expect(currentKind(caretIn('## Title\n', 'itle'))).toBe('heading-2')
    expect(currentKind(caretIn('#### Deep\n', 'eep'))).toBeUndefined()
    expect(currentKind(caretIn('- item\n', 'tem'))).toBe('bullet-list')
    expect(currentKind(caretIn('1. item\n', 'tem'))).toBe('numbered-list')
    expect(currentKind(caretIn('- [ ] item\n', 'tem'))).toBe('task-list')
    expect(currentKind(caretIn('> quoted\n', 'uoted'))).toBe('quote')
    expect(currentKind(caretIn('> [!NOTE]\n> noted\n', 'oted'))).toBe('callout')
    expect(currentKind(caretIn(':::callout{type="tip"}\ntipped\n:::\n', 'ipped'))).toBe('callout')
    expect(currentKind(caretIn('```\ncode\n```\n', 'ode'))).toBeUndefined()
    // Inside a table cell, the cell is not a wrapper "Turn into" takes it out of.
    expect(currentKind(caretIn('| a |\n| - |\n| b |\n', 'b'))).toBe('paragraph')
  })

  it.each([
    ['heading-1', '# Words\n'],
    ['heading-3', '### Words\n'],
    ['bullet-list', '- Words\n'],
    ['numbered-list', '1. Words\n'],
    ['task-list', '- [ ] Words\n'],
    ['quote', '> Words\n'],
    ['callout', ':::callout{type="note"}\nWords\n:::\n'],
  ] as const)('turns text into %s', (target, expected) => {
    expect(markdownOf(run(caretIn('Words\n', 'ords'), turnInto(target)))).toBe(expected)
  })

  it('takes a block out of its list, quote or callout first', () => {
    expect(markdownOf(run(caretIn('- Words\n', 'ords'), turnInto('paragraph')))).toBe('Words\n')
    expect(markdownOf(run(caretIn('> Words\n', 'ords'), turnInto('heading-2')))).toBe('## Words\n')
    expect(markdownOf(run(caretIn('- Words\n', 'ords'), turnInto('numbered-list')))).toBe(
      '1. Words\n',
    )
    expect(
      markdownOf(run(caretIn(':::callout{type="tip"}\nWords\n:::\n', 'ords'), turnInto('quote'))),
    ).toBe('> Words\n')
  })

  it('turns a heading into a list item as a paragraph, since an item opens with one', () => {
    expect(markdownOf(run(caretIn('## Words\n', 'ords'), turnInto('bullet-list')))).toBe(
      '- Words\n',
    )
  })

  it('is one undo step, and does nothing when the block is already that kind', () => {
    expect(turnInto('paragraph')(caretIn('Words\n', 'ords'))).toBe(false)
    expect(turnInto('quote')(caretIn('```\ncode\n```\n', 'ode'))).toBe(false)
  })

  it('names every kind', () => {
    expect(TURN_INTO.map((target) => TURN_INTO_LABELS[target])).toContain('Bulleted list')
  })
})

const never: Command = () => false

describe('running commands in sequence', () => {
  it('does nothing when the last command cannot act, whatever came before', () => {
    const state = caretIn('Words\n', 'ords')
    expect(sequence(turnInto('heading-1'), never)(state)).toBe(false)
    expect(sequence(never, turnInto('heading-1'))(state)).toBe(true)
  })
})

describe('shortcut labels', () => {
  it('read as Ctrl on most platforms and as symbols on Apple’s', () => {
    expect(shortcutLabel(SHORTCUTS.strike, false)).toBe('Ctrl+Shift+X')
    expect(shortcutLabel(SHORTCUTS.strike, true)).toBe('⌘⇧X')
    expect(shortcutLabel(SHORTCUTS.clearFormatting, false)).toBe('Ctrl+\\')
    expect(shortcutLabel(SHORTCUTS.toolbar, true)).toBe('⌥F10')
    expect(shortcutLabel(SHORTCUTS.moveUp, false)).toBe('Ctrl+Shift+↑')
    expect(shortcutLabel('Ctrl-Alt-q', true)).toBe('⌃⌥Q')
    expect(shortcutLabel('Hyper-q', true)).toBe('HyperQ')
  })

  it('tell Apple’s platforms from the rest', () => {
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true)
    expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' })).toBe(true)
    expect(isApplePlatform({ platform: 'Win32' })).toBe(false)
    expect(isApplePlatform({})).toBe(false)
    expect(shortcutFor('bold')).toMatch(/B$/)
  })
})

describe('the edges of formatting', () => {
  it('does not count a selection that runs out of small print as inside it', () => {
    const state = stateOf('A :small[quiet] and loud.\n')
    let quiet = 0
    let and = 0
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'quiet') quiet = pos
      if (node.isText && node.text?.includes('and') === true) and = pos + 3
      return true
    })
    const across = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, quiet + 1, and)),
    )
    expect(directiveActive(across, 'small')).toBe(false)
  })

  it('answers whether it would act without acting', () => {
    const badge = stateOf('Status :badge[Built] today.\n', 'Built')
    expect(toggleFormatDirective('badge')(badge)).toBe(true)
    expect(toggleFormatDirective('small')(stateOf('Words.\n', 'Words'))).toBe(true)
    expect(clearFormatting(stateOf('A **bold** word.\n', 'bold'))).toBe(true)
  })

  it('leaves a block in a details where it is, turning only the block', () => {
    const source = ':::details[More]\nHidden words\n:::\n'
    expect(markdownOf(run(caretIn(source, 'idden'), turnInto('heading-2')))).toBe(
      ':::details[More]\n## Hidden words\n:::\n',
    )
  })
})
