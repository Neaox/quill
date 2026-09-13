import { describe, expect, it } from 'vitest'

import { editorSchema } from './editor-schema.ts'
import { markType, nodeType } from './node-type.ts'

describe('looking a type up by name', () => {
  it('finds the node and the mark', () => {
    expect(nodeType(editorSchema, 'paragraph').name).toBe('paragraph')
    expect(markType(editorSchema, 'link').name).toBe('link')
  })

  it('names the failure when the schema has no such type', () => {
    expect(() => nodeType(editorSchema, 'sonnet')).toThrow('The schema has no "sonnet" node.')
    expect(() => markType(editorSchema, 'sonnet')).toThrow('The schema has no "sonnet" mark.')
  })
})
