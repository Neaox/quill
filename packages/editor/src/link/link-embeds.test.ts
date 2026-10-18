import { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { embedHintFor, linkEmbedsPlugin, recordLinkEmbed } from './link-embeds.ts'

const harness = createEditorTestHarness()
const ADDRESS = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const HINT = { provider: 'YouTube', aspectRatio: 16 / 9 }

function open(): EditorState {
  const bare = harness.state('Some words.')
  return EditorState.create({ doc: bare.doc, plugins: [linkEmbedsPlugin()] })
}

describe('what the editor is told about embeds', () => {
  it('knows nothing until it is told', () => {
    expect(embedHintFor(open(), ADDRESS)).toBeUndefined()
  })

  it('holds an address’s hint once recorded, and forgets it when told it cannot be embedded', () => {
    const state = open()
    const recorded = recordLinkEmbed(state, ADDRESS, HINT)
    if (recorded === null) throw new Error('expected a transaction')
    const known = state.apply(recorded)
    expect(embedHintFor(known, ADDRESS)).toEqual(HINT)
    expect(embedHintFor(known, 'https://other.example/')).toBeUndefined()

    const forgotten = recordLinkEmbed(known, ADDRESS, null)
    if (forgotten === null) throw new Error('expected a transaction')
    expect(embedHintFor(known.apply(forgotten), ADDRESS)).toBeUndefined()
  })

  it('makes no transaction when the state already holds the answer', () => {
    const state = open()
    expect(recordLinkEmbed(state, ADDRESS, null)).toBeNull()
    const recorded = recordLinkEmbed(state, ADDRESS, HINT)
    if (recorded === null) throw new Error('expected a transaction')
    expect(recordLinkEmbed(state.apply(recorded), ADDRESS, { ...HINT })).toBeNull()
  })

  it('is not an edit: it leaves the document alone and out of the undo history', () => {
    const state = open()
    const recorded = recordLinkEmbed(state, ADDRESS, HINT)
    if (recorded === null) throw new Error('expected a transaction')
    expect(recorded.docChanged).toBe(false)
    expect(recorded.getMeta('addToHistory')).toBe(false)
  })
})
