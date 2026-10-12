// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedMenuLink } from '@quill/application'

import { currentDocument, domEvent, stubMatchMedia, type TestElement } from '../test-support/dom.ts'
import { SCHEME_SCRIPT } from './scheme-script.ts'
import { renderHeaderMenu } from './templates/header-menu.ts'

/**
 * What the page's script adds to the header menu's dropdowns, in a DOM: one
 * open at a time, Escape closes and returns focus, and a click elsewhere
 * closes. Without the script the dropdowns are plain `details` and still open
 * and close, which `templates/header-menu.test.ts` covers.
 */

const link = (label: string): ResolvedMenuLink => ({
  label,
  href: `/${label}`,
  external: false,
  referrer: 'hidden',
})

const document = currentDocument()

beforeEach(() => {
  document.body.innerHTML = `${
    renderHeaderMenu({
      audience: 'public',
      menu: [
        { kind: 'group', label: 'One', links: [link('a'), link('b')] },
        { kind: 'group', label: 'Two', links: [link('c')] },
      ],
      currentHref: null,
    }).value
  }<button id="elsewhere">Elsewhere</button>`
  stubMatchMedia()
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script under test is a string served to browsers.
  new Function(SCHEME_SCRIPT)()
})

const dropdowns = (): TestElement[] => [...document.querySelectorAll('.site-bar details')]

/** `toggle` is queued as a task, so a test waits for it as a browser would. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the header menu’s dropdowns, with the script', () => {
  it('keeps one open at a time', async () => {
    const [one, two] = dropdowns()
    if (one === undefined || two === undefined) throw new Error('expected two dropdowns')
    one.open = true
    await settle()
    two.open = true
    await settle()
    expect(one.open).toBe(false)
    expect(two.open).toBe(true)
  })

  it('closes on Escape and puts focus back on the trigger', () => {
    const [one] = dropdowns()
    if (one === undefined) throw new Error('expected a dropdown')
    one.open = true
    const inner = one.querySelector('a')
    inner?.focus()
    inner?.dispatchEvent(domEvent('KeyboardEvent', 'keydown', { key: 'Escape' }))
    expect(one.open).toBe(false)
    expect(document.activeElement).toBe(one.querySelector('summary'))
  })

  it('closes on a click elsewhere, and stays open for a click inside', () => {
    const [one] = dropdowns()
    if (one === undefined) throw new Error('expected a dropdown')
    one.open = true
    one.querySelector('ul')?.dispatchEvent(domEvent('MouseEvent', 'click'))
    expect(one.open).toBe(true)
    document.querySelector('#elsewhere')?.dispatchEvent(domEvent('MouseEvent', 'click'))
    expect(one.open).toBe(false)
  })

  it('closes when focus moves out of it, not when it moves within it', () => {
    const [one] = dropdowns()
    if (one === undefined) throw new Error('expected a dropdown')
    one.open = true
    const [first, second] = [...one.querySelectorAll('a')]
    first?.dispatchEvent(domEvent('FocusEvent', 'focusout', { relatedTarget: second ?? null }))
    expect(one.open).toBe(true)
    const outside = document.querySelector('#elsewhere')
    first?.dispatchEvent(domEvent('FocusEvent', 'focusout', { relatedTarget: outside }))
    expect(one.open).toBe(false)
  })
})
