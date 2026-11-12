import { describe, expect, it } from 'vitest'

import { mathDom, renderMath } from '@quill/markdown/math'

describe('a formula as the editor’s own nodes', () => {
  it('builds the MathML tree the server would draw, element by element', () => {
    const rendering = renderMath(String.raw`\frac{a}{b}`, true)
    if (rendering.kind !== 'math') throw new Error(rendering.message)

    const node = mathDom(rendering.math, document)
    if (!(node instanceof Element)) throw new Error('not an element')

    expect(node.nodeName.toLowerCase()).toBe('math')
    expect(node.getAttribute('display')).toBe('block')
    expect(node.textContent).toBe('ab')
    expect(node.querySelector('mfrac')).not.toBeNull()
  })

  it('makes text where the tree holds text', () => {
    const node = mathDom('x', document)

    expect(node.nodeType).toBe(Node.TEXT_NODE)
    expect(node.textContent).toBe('x')
  })
})
