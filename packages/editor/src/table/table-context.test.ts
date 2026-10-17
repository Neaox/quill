import { EditorState, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { editorSchema } from '../schema/editor-schema.ts'
import { nodeType } from '../schema/node-type.ts'
import { tableContext, wrapperAttributes } from './table-context.ts'

function wrapper(attributes: unknown) {
  return nodeType(editorSchema, 'containerDirective').create({ name: 'table', attributes })
}

describe('a table wrapper’s attributes', () => {
  it('reads each as text, and a value with nothing in it as empty text', () => {
    expect(wrapperAttributes(wrapper({ columns: '1fr 2fr', sortable: null, limit: 5 }))).toEqual({
      columns: '1fr 2fr',
      sortable: '',
      limit: '5',
    })
  })

  it('reads none from a wrapper that is not there or holds no record', () => {
    expect(wrapperAttributes(undefined)).toEqual({})
    expect(wrapperAttributes(wrapper(null))).toEqual({})
  })
})

describe('the table the caret is in', () => {
  it('is none in a table wrapper that holds no table', () => {
    const paragraph = nodeType(editorSchema, 'paragraph').create(null, editorSchema.text('Caption'))
    const held = nodeType(editorSchema, 'containerDirective').create(
      { name: 'table', attributes: {} },
      paragraph,
    )
    const doc = nodeType(editorSchema, 'doc').create(null, held)
    const state = EditorState.create({ schema: editorSchema, doc })
    const placed = state.apply(state.tr.setSelection(TextSelection.create(doc, 3)))

    expect(tableContext(placed)).toBeUndefined()
  })
})
