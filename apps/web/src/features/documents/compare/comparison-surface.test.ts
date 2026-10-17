import { describe, expect, it, vi } from 'vitest'

import { enhanceComparison } from './comparison-surface.ts'

function article(html: string): HTMLElement {
  const element = document.createElement('article')
  element.innerHTML = html
  document.body.replaceChildren(element)
  return element
}

const paragraphs = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => `<p>Paragraph ${from + index}.</p>`).join('')

describe('enhanceComparison', () => {
  it('folds a long unchanged stretch behind a button that says what it holds', () => {
    const root = article(
      `${paragraphs(1)}<p data-change="changed" data-change-id="c1">Edited.</p>${paragraphs(8, 2)}<p data-change="added" data-change-id="c2">New.</p>`,
    )
    enhanceComparison(root)

    const folds = root.querySelectorAll('button.comparison-fold')
    expect(folds).toHaveLength(1)
    expect(folds[0]?.textContent).toBe('Show 6 unchanged paragraphs')
    // One block of context stays on each side of a change.
    const visible = [...root.querySelectorAll('p:not([hidden])')].map((p) => p.textContent)
    expect(visible).toEqual(['Paragraph 1.', 'Edited.', 'Paragraph 2.', 'Paragraph 9.', 'New.'])
  })

  it('leaves a short stretch alone, and says "blocks" for a stretch that is not all paragraphs', () => {
    const root = article(
      `<p data-change="added" data-change-id="c1">New.</p>${paragraphs(3)}<h2 id="x">Heading</h2>${paragraphs(4, 4)}<ul><li>x</li></ul>`,
    )
    enhanceComparison(root)
    expect(root.querySelector('button.comparison-fold')?.textContent).toBe(
      'Show 8 unchanged blocks',
    )
  })

  it('unfolds a stretch when its button is pressed, and moves focus into it', () => {
    const root = article(`<p data-change="added" data-change-id="c1">New.</p>${paragraphs(10)}`)
    enhanceComparison(root)
    const fold = root.querySelector<HTMLButtonElement>('button.comparison-fold')
    fold?.click()

    expect(root.querySelector('[hidden]')).toBeNull()
    expect(root.querySelector('button.comparison-fold')).toBeNull()
    expect(document.activeElement?.textContent).toBe('Paragraph 2.')
  })

  it('goes to a change: marks it current, focuses it and scrolls it into view', () => {
    const root = article(
      `<p data-change="added" data-change-id="c1">One.</p>${paragraphs(10)}<p data-change="removed" data-change-id="c2">Two.</p>`,
    )
    const scroll = vi.fn<() => void>()
    HTMLElement.prototype.scrollIntoView = scroll
    const surface = enhanceComparison(root)

    surface.goTo('c2')

    const target = root.querySelector('[data-change-id="c2"]')
    expect(target).toHaveAttribute('data-change-current')
    expect(target).toHaveFocus()
    expect(scroll).toHaveBeenCalled()
    surface.goTo('c1')
    expect(target).not.toHaveAttribute('data-change-current')
  })

  it('reveals a heading folded away, for the contents to jump to', () => {
    const root = article(
      `<p data-change="added" data-change-id="c1">One.</p>${paragraphs(4)}<h2 id="deep">Deep</h2>${paragraphs(4, 5)}`,
    )
    const surface = enhanceComparison(root)
    const heading = root.querySelector('#deep')
    expect(heading).toHaveAttribute('hidden')

    surface.reveal(heading)

    expect(heading).not.toHaveAttribute('hidden')
  })

  it('folds nothing when nothing changed, and undoes itself', () => {
    const root = article(paragraphs(12))
    const surface = enhanceComparison(root)
    expect(root.querySelector('button')).toBeNull()

    const changed = article(`<p data-change="added" data-change-id="c1">New.</p>${paragraphs(10)}`)
    enhanceComparison(changed).dispose()
    expect(changed.querySelector('button, [hidden], [tabindex]')).toBeNull()
    surface.dispose()
  })
})
