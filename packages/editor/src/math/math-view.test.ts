import type { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { baseExtensions, editorSchema } from '../schema/editor-schema.ts'
import { MathNodeView, withMathView } from './math-view.ts'

function mathNode(name: 'mathInline' | 'mathBlock', value: string): PMNode {
  const type = editorSchema.nodes[name]
  if (type === undefined) throw new Error(`no ${name} node`)
  return type.create({ value })
}

describe('math while writing', () => {
  it('draws a sentence’s formula as the reader will, without becoming content', () => {
    const view = new MathNodeView(mathNode('mathInline', String.raw`\pi r^2`))

    expect(view.dom.tagName).toBe('SPAN')
    expect(view.dom.dataset['math']).toBe('inline')
    expect(view.dom.contentEditable).toBe('false')
    expect(view.dom.querySelector('math')).not.toBeNull()
    expect(view.dom.textContent).toBe('πr2')
  })

  it('draws a block in a div, as display MathML', () => {
    const view = new MathNodeView(mathNode('mathBlock', 'x^2'))

    expect(view.dom.tagName).toBe('DIV')
    expect(view.dom.dataset['math']).toBe('display')
    expect(view.dom.querySelector('math')?.getAttribute('display')).toBe('block')
  })

  it('redraws an edited formula, and refuses a different node', () => {
    const view = new MathNodeView(mathNode('mathInline', 'x'))

    expect(view.update(mathNode('mathInline', 'y'))).toBe(true)
    expect(view.dom.querySelector('math')?.textContent).toBe('y')
    expect(view.update(mathNode('mathBlock', 'y'))).toBe(false)
  })

  it('shows a formula it cannot draw as the TeX and the reason', () => {
    const view = new MathNodeView(mathNode('mathBlock', String.raw`\frac{`))

    expect(view.dom.classList.contains('math-error')).toBe(true)
    expect(view.dom.querySelector('code')?.title).toContain('Invalid math: ')
    expect(view.dom.querySelector('.math-error-message')).not.toBeNull()
  })

  it('gives both atoms a node view in the editor’s extension list', () => {
    const extensions = withMathView(baseExtensions)
    const names = extensions
      .filter((extension) => extension.type === 'node')
      .filter((extension) => extension.name === 'mathInline' || extension.name === 'mathBlock')
      .map((extension) => extension.name)

    expect(names).toEqual(['mathInline', 'mathBlock'])
  })
})
