import { describe, expect, it } from 'vitest'

import { peekTarget } from './peek-target.ts'

function article(html: string): HTMLElement {
  const element = document.createElement('article')
  element.innerHTML = html
  return element
}

const find = (root: HTMLElement, selector: string) => root.querySelector(selector)

describe('peekTarget', () => {
  it('is the link a pointer is over, from a node inside it', () => {
    const root = article('<p><a href="https://blog.example/post"><em>words</em></a></p>')
    expect(peekTarget(find(root, 'em'), root)?.href).toBe('https://blog.example/post')
  })

  it.each([
    ['a link to the same site', '<a href="/docs/other">x</a>'],
    ['a link into the page', '<a href="#section">x</a>'],
    ['a mail link', '<a href="mailto:a@b.example">x</a>'],
    ['a link with no address', '<a>x</a>'],
    ['a heading anchor', '<a class="heading-anchor" href="https://blog.example/#h">#</a>'],
    [
      'a card, which already says it all',
      '<a class="link-card" href="https://blog.example/p">x</a>',
    ],
    ['a link to a document written in the same origin', `<a href="${location.origin}/d/abc">x</a>`],
  ])('is nothing for %s', (_name, html) => {
    const root = article(`<p>${html}</p>`)
    expect(peekTarget(find(root, 'a'), root)).toBeNull()
  })

  it('is nothing for a node outside the article', () => {
    const root = article('<p>text</p>')
    const outside = document.createElement('a')
    outside.href = 'https://blog.example/post'
    expect(peekTarget(outside, root)).toBeNull()
  })

  it('is nothing when the pointer is not over a node at all', () => {
    expect(peekTarget(null, article(''))).toBeNull()
    expect(peekTarget(window, article(''))).toBeNull()
  })
})
