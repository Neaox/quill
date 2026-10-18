import { describe, expect, it } from 'vitest'

import { directiveAttributes, directiveName } from './directive-attributes.ts'
import { editorSchema } from './editor-schema.ts'
import { nodeType } from './node-type.ts'

function directive(attributes: unknown, name: unknown = 'note') {
  return nodeType(editorSchema, 'containerDirective').create({ name, attributes })
}

describe('a directive’s attributes', () => {
  it('reads each as the text the Markdown carried', () => {
    expect(directiveAttributes(directive({ tone: 'info', open: '', count: 3 }))).toEqual({
      tone: 'info',
      open: '',
      count: '3',
    })
  })

  it('reads a missing value as empty text', () => {
    expect(directiveAttributes(directive({ flag: null }))).toEqual({ flag: '' })
  })

  it('reads attributes that are not a record as none at all', () => {
    expect(directiveAttributes(directive(null))).toEqual({})
    expect(directiveAttributes(directive('tone=info'))).toEqual({})
  })
})

describe('a directive’s name', () => {
  it('is the name it was written with', () => {
    expect(directiveName(directive({}, 'accordion'))).toBe('accordion')
  })

  it('is nothing for a node that is not a directive', () => {
    expect(directiveName(directive({}, null))).toBeUndefined()
  })
})
