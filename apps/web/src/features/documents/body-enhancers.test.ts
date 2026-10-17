import { describe, expect, it } from 'vitest'

import { enhanceBody } from './body-enhancers.ts'

function articleOf(html: string): HTMLElement {
  const article = document.createElement('article')
  article.innerHTML = html
  return article
}

const TABLE =
  '<div class="table-block"><div class="table-scroll"><table><thead><tr><th scope="col">A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div></div>'

describe('enhanceBody', () => {
  it('has nothing to wait for in a body with nothing to enhance', async () => {
    const article = articleOf('<p>Just prose.</p>')

    await expect(enhanceBody(article, { expandImages: true }).ready).resolves.toBe(true)

    expect(article.innerHTML).toBe('<p>Just prose.</p>')
  })

  it('enhances what the body contains once the enhancers have arrived', async () => {
    const article = articleOf(TABLE)

    await expect(enhanceBody(article, { expandImages: false }).ready).resolves.toBe(true)

    expect(article.querySelector('.table-block')).toHaveAttribute('data-enhanced')
  })

  it('applies nothing to a body it was disposed of before the enhancers arrived', async () => {
    const article = articleOf(TABLE)
    const enhancement = enhanceBody(article, { expandImages: false })

    enhancement.dispose()

    await expect(enhancement.ready).resolves.toBe(false)
    expect(article.querySelector('.table-block')).not.toHaveAttribute('data-enhanced')
  })

  it('leaves pictures alone unless the surface asks for the viewer', async () => {
    const article = articleOf('<p><img src="/a.png" alt="A"></p>')

    await enhanceBody(article, { expandImages: false }).ready

    expect(article.querySelector('button')).toBeNull()
  })
})
