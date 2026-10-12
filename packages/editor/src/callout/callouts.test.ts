import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { transactionOf } from '../format/transactions.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import {
  calloutAt,
  calloutLabel,
  calloutTypeOf,
  CALLOUT_PURPOSES,
  CALLOUT_TYPES,
  deleteCallout,
  isCallout,
  setCalloutType,
  unwrapCallout,
  wrapInCallout,
} from './callouts.ts'

const harness = createEditorTestHarness()

const SOURCE = [
  'Before.',
  '',
  ':::callout{type=warning}',
  'Mind the gap.',
  '',
  'Second paragraph.',
  ':::',
  '',
  'After.',
  '',
].join('\n')

/** A caret in the first text that contains `needle`. */
function caretIn(markdown: string, needle: string): EditorState {
  const opened = harness.state(markdown)
  let found = -1
  opened.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(needle) === true) found = pos + 1
  })
  return opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, found)))
}

function run(command: Command, state: EditorState): string | null {
  const tr = transactionOf(command, state)
  return tr === null ? null : harness.read(documentToMdast(state.apply(tr).doc).tree)
}

describe('finding the callout the selection is in', () => {
  it('finds it from a caret in any of its blocks', () => {
    for (const needle of ['Mind', 'Second']) {
      expect(calloutAt(caretIn(SOURCE, needle))).toMatchObject({ type: 'warning' })
    }
  })

  it('finds nothing outside one', () => {
    expect(calloutAt(caretIn(SOURCE, 'Before'))).toBeNull()
    expect(calloutAt(caretIn(SOURCE, 'After'))).toBeNull()
  })

  it('finds a callout that is itself selected', () => {
    const opened = harness.state(SOURCE)
    const selected = opened.apply(opened.tr.setSelection(NodeSelection.create(opened.doc, 9)))
    expect(calloutAt(selected)).toMatchObject({ pos: 9, type: 'warning' })
  })

  it('finds the innermost callout of two nested ones', () => {
    const nested = [
      '::::callout{type=info}',
      ':::callout{type=tip}',
      'Inner.',
      ':::',
      '::::',
      '',
    ].join('\n')
    expect(calloutAt(caretIn(nested, 'Inner'))?.type).toBe('tip')
  })

  it('does not mistake another directive for a callout', () => {
    const guidance = ':::guidance\nAdvice.\n:::\n'
    expect(calloutAt(caretIn(guidance, 'Advice'))).toBeNull()
    expect(isCallout(harness.state(guidance).doc.child(0))).toBe(false)
  })

  it('reads a missing or unknown type as the default one', () => {
    expect(calloutAt(caretIn(':::callout\nBare.\n:::\n', 'Bare'))?.type).toBe('note')
    expect(calloutTypeOf(harness.state(':::callout{type=nuclear}\nx\n:::\n').doc.child(0))).toBe(
      'note',
    )
  })
})

const INFO = ':::callout{type=info}\nBody.\n:::\n'

describe('changing a callout’s variant', () => {
  it.each(CALLOUT_TYPES.filter((type) => type !== 'info'))('changes it to %s', (type) => {
    const markdown = run(setCalloutType(type), caretIn(INFO, 'Body'))
    expect(markdown).toBe(`:::callout{type="${type}"}\nBody.\n:::\n`)
  })

  it('declines to change a callout to the variant it already is', () => {
    expect(run(setCalloutType('info'), caretIn(INFO, 'Body'))).toBeNull()
  })

  it('leaves the body and every other attribute as they were', () => {
    const source = ':::callout{type=info id=a1 class=wide}\nBody.\n\nMore.\n:::\n'
    const markdown = run(setCalloutType('caution'), caretIn(source, 'More'))
    expect(markdown).toContain('type="caution"')
    expect(markdown).toContain('#a1 .wide')
    expect(markdown).toContain('Body.\n\nMore.')
  })

  it('declines outside a callout', () => {
    expect(run(setCalloutType('tip'), caretIn(SOURCE, 'Before'))).toBeNull()
  })
})

describe('removing a callout', () => {
  it('unwraps it and keeps everything inside', () => {
    expect(run(unwrapCallout, caretIn(SOURCE, 'Mind'))).toBe(
      'Before.\n\nMind the gap.\n\nSecond paragraph.\n\nAfter.\n',
    )
  })

  it('deletes it and what was inside', () => {
    expect(run(deleteCallout, caretIn(SOURCE, 'Mind'))).toBe('Before.\n\nAfter.\n')
  })

  it('will not delete the only block of the document', () => {
    expect(run(deleteCallout, caretIn(':::callout\nOnly.\n:::\n', 'Only'))).toBeNull()
  })

  it('declines outside a callout', () => {
    expect(run(unwrapCallout, caretIn(SOURCE, 'Before'))).toBeNull()
    expect(run(deleteCallout, caretIn(SOURCE, 'Before'))).toBeNull()
  })
})

describe('making a callout out of what is already written', () => {
  it('wraps the block the caret is in, as the standard quote', () => {
    expect(run(wrapInCallout('tip'), caretIn(SOURCE, 'Before'))).toContain('> [!TIP]\n> Before.\n')
  })

  it('wraps every block a selection covers', () => {
    const opened = harness.state('One.\n\nTwo.\n\nThree.\n')
    const covering = opened.apply(
      opened.tr
        .setSelection(Selection.near(opened.doc.resolve(2)))
        .setSelection(TextSelection.create(opened.doc, 2, 8)),
    )
    expect(run(wrapInCallout('info'), covering)).toBe('> [!info]\n> One.\n>\n> Two.\n\nThree.\n')
  })

  it('does not nest a callout in a callout', () => {
    expect(run(wrapInCallout('tip'), caretIn(SOURCE, 'Mind'))).toBeNull()
  })
})

describe('naming the variants', () => {
  it('has a label and a purpose for each, in the words a picker shows', () => {
    expect(CALLOUT_TYPES.map(calloutLabel)).toEqual([
      'Note',
      'Info',
      'Tip',
      'Important',
      'Warning',
      'Caution',
    ])
    for (const type of CALLOUT_TYPES) expect(CALLOUT_PURPOSES[type].length).toBeGreaterThan(10)
  })
})
