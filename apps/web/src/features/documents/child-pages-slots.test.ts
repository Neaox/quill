import { renderChildPages } from '@quill/markdown'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CHILD_PAGES_UNAVAILABLE,
  CREATE_CHILD_PAGE,
  fillChildPageSlots,
} from './child-pages-slots.ts'

const SLOT = (key: string, title = '') =>
  `<section class="live-block child-pages" data-live-block="children" data-live-key="${key}" ${
    title === '' ? 'aria-label="Child pages"' : 'aria-labelledby="t"'
  }>${title === '' ? '' : `<p class="child-pages-title" id="t">${title}</p>`}<p class="child-pages-fallback">The pages under this one are listed here.</p></section>`

const LIST = renderChildPages(
  [
    {
      id: 'a',
      title: 'Install',
      href: '/d/a',
      draft: false,
      excerpt: 'How to install it.',
      icon: '📦',
      children: [],
    },
  ],
  { depth: 1, sort: 'manual', excerpts: true, icons: true },
)

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<main><article class="prose">${html}</article></main>`
  const article = document.querySelector('article')
  if (article === null) throw new Error('no article')
  return article
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  document.body.replaceChildren()
})

describe('filling child pages slots', () => {
  it('asks once per slot, for the options its key names, and keeps its title', async () => {
    const article = mount(SLOT('children?depth=2&sort=title&excerpts&icons', 'Guides'))
    const load = vi.fn(async () => ({ html: LIST, count: 1 }))
    fillChildPageSlots(article, { load })

    const slot = article.querySelector('section')
    expect(slot?.getAttribute('aria-busy')).toBe('true')
    expect(load).toHaveBeenCalledWith(
      { depth: 2, sort: 'title', excerpts: true, icons: true },
      expect.any(AbortSignal),
    )
    await settle()
    expect(slot?.hasAttribute('aria-busy')).toBe(false)
    expect(slot?.querySelector('.child-pages-title')?.textContent).toBe('Guides')
    expect(slot?.querySelector('.child-pages-fallback')).toBeNull()
    expect(slot?.querySelector('a')?.getAttribute('href')).toBe('/d/a')
    await expectNoAccessibilityViolations(document.body)
  })

  it('offers to create a child page in an empty list, to someone who can', async () => {
    const article = mount(SLOT('children?depth=1&sort=manual'))
    const create = vi.fn()
    const empty = '<p class="child-pages-empty">No child pages yet</p>'
    fillChildPageSlots(article, {
      load: async () => ({ html: empty, count: 0 }),
      createChildPage: create,
    })
    await settle()
    expect(article.textContent).toContain('No child pages yet')
    await userEvent.click(document.querySelector('button') ?? document.body)
    expect(create).toHaveBeenCalledTimes(1)
    expect(document.querySelector('button')?.textContent).toBe(CREATE_CHILD_PAGE)
    await expectNoAccessibilityViolations(document.body)
  })

  it('offers nothing to a reader who cannot write here', async () => {
    const article = mount(SLOT('children?depth=1&sort=manual'))
    fillChildPageSlots(article, {
      load: async () => ({ html: '<p class="child-pages-empty">No child pages yet</p>', count: 0 }),
    })
    await settle()
    expect(article.querySelector('button')).toBeNull()
  })

  it('says the list could not be loaded, rather than leaving a hole', async () => {
    const article = mount(SLOT('children?depth=1&sort=manual'))
    fillChildPageSlots(article, {
      load: async () => {
        throw new Error('offline')
      },
    })
    await settle()
    expect(article.querySelector('.child-pages-fallback')?.textContent).toBe(
      CHILD_PAGES_UNAVAILABLE,
    )
    expect(article.querySelector('section')?.hasAttribute('aria-busy')).toBe(false)
  })

  it('stops asking when the body is taken away, and says nothing about it', async () => {
    const article = mount(SLOT('children?depth=1&sort=manual'))
    const undo = fillChildPageSlots(article, {
      load: (_query, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        }),
    })
    undo()
    await settle()
    expect(article.querySelector('.child-pages-fallback')?.textContent).not.toBe(
      CHILD_PAGES_UNAVAILABLE,
    )
  })

  it('leaves a slot whose key it cannot read as it is', () => {
    const article = mount(SLOT('children?depth=9'))
    const load = vi.fn()
    fillChildPageSlots(article, { load })
    expect(load).not.toHaveBeenCalled()
    expect(article.querySelector('section')?.hasAttribute('aria-busy')).toBe(false)
  })
})
