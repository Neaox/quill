import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { accountMenu } from './support/account.ts'
import {
  code,
  collectionId,
  heading,
  paragraph,
  publishDocument,
  table,
} from './support/content.ts'
import { seedDevelopmentData } from './support/seed.ts'

/**
 * WCAG 2.4.11, Focus Not Obscured: whatever the keyboard reaches is scrolled
 * clear of the sticky chrome, forwards and backwards, on a phone held
 * sideways at 400 % zoom (320 × 256) and on a laptop (1280 × 900), in the
 * signed-in reader. The page's scroll padding is the chrome (`html` in
 * `tokens.css`, and its twin in `public-site.css` for the public site, whose
 * end-to-end environment does not allow publishing to the web), so a browser
 * keeps focus out from under it; before it, 58 stops on one page were hidden.
 *
 * The document is this test's own, so four browser profiles running at once
 * never share it.
 */

type MdastNode = ReturnType<typeof heading>

const SIZES = [
  { width: 320, height: 256 },
  { width: 1280, height: 900 },
] as const

/** Sections, each a heading (and its permalink), a table and a code block: many stops, spread down a long page. */
function blocks(): MdastNode[] {
  return Array.from({ length: 5 }, (_, index) => [
    heading(2, `Section ${String(index + 1)}`),
    paragraph('A paragraph long enough to push the next stop down the page. '.repeat(6)),
    table([
      ['Region', 'Requests', 'Owner'],
      ['eu-west', '120', 'Platform'],
      ['us-east', '98', 'Payments'],
    ]),
    code(
      'ts',
      `const section${String(index)} = ${'"a long line that scrolls sideways", '.repeat(6)}`,
    ),
  ]).flat()
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: false }).fill(email)
  await page.getByLabel('Password', { exact: false }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(accountMenu(page)).toBeVisible()
}

interface Stop {
  readonly name: string
  readonly top: number
  readonly bottom: number
  readonly chrome: number
}

/**
 * Where the focused element is, against the bottom of the sticky bar; null off the page's content.
 *
 * Read once the page has drawn the frame after the key press, which is the
 * first moment a reader can see where focus went. WebKit settles a focus
 * scroll there rather than inside the key press: a key pressed at machine
 * speed, in the same frame as the last one's scroll, can otherwise find the
 * new stop still under the bar, and the very next frame has it clear. What
 * this asserts is unchanged — a stop still covered once drawn fails.
 */
async function focused(page: Page, bar: string): Promise<Stop | null> {
  await page.evaluate(
    () =>
      new Promise((drawn) => {
        requestAnimationFrame(() => requestAnimationFrame(drawn))
      }),
  )
  return page.evaluate((selector) => {
    const element = document.activeElement
    const header = document.querySelector(selector)
    if (element === null || element === document.body || header === null) return null
    if (header.contains(element) || element.closest('header, nav, aside') !== null) return null
    if (element.closest('article') === null) return null
    const box = element.getBoundingClientRect()
    return {
      name: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? '',
      top: box.top,
      bottom: box.bottom,
      chrome: header.getBoundingClientRect().bottom,
    }
  }, bar)
}

/** Tabs through the article one way, and answers every stop the bar covered entirely. */
async function hiddenStops(page: Page, bar: string, key: 'Tab' | 'Shift+Tab'): Promise<string[]> {
  const hidden: string[] = []
  let seen = 0
  for (let step = 0; step < 150; step += 1) {
    await page.keyboard.press(key)
    const stop = await focused(page, bar)
    if (stop === null) {
      if (seen > 0) break
      continue
    }
    seen += 1
    if (stop.bottom <= stop.chrome) hidden.push(stop.name)
  }
  expect(seen).toBeGreaterThan(20)
  return hidden
}

/**
 * Puts the focus on the article's first or last stop without scrolling to it,
 * with the page at that end, so the walk starts where a reader would.
 */
async function startAt(page: Page, end: 'first' | 'last'): Promise<void> {
  await page.evaluate((which) => {
    const stops = [
      ...document.querySelectorAll<HTMLElement>(
        'article a[href], article button, article [tabindex="0"]',
      ),
    ]
    window.scrollTo(0, which === 'first' ? 0 : document.documentElement.scrollHeight)
    stops.at(which === 'first' ? 0 : -1)?.focus({ preventScroll: true })
  }, end)
}

async function walkBothWays(page: Page, url: string, bar: string): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size)
    await page.goto(url)
    await expect(page.locator('article h2').first()).toBeVisible()

    await startAt(page, 'first')
    expect(await hiddenStops(page, bar, 'Tab'), `forwards at ${String(size.width)}`).toEqual([])

    await startAt(page, 'last')
    expect(await hiddenStops(page, bar, 'Shift+Tab'), `backwards at ${String(size.width)}`).toEqual(
      [],
    )
  }
}

test('focus is never hidden under the sticky chrome, tabbing either way', async ({ page }) => {
  test.setTimeout(240_000)
  const seed = seedDevelopmentData()
  const suffix = randomUUID().slice(0, 8)
  await signIn(page, seed.adminEmail, seed.adminPassword)

  const document = await publishDocument(page.request, {
    workspaceId: seed.workspaceId,
    collectionId: await collectionId(page.request, seed.workspaceId, 'Architecture'),
    title: `Focus walk ${suffix}`,
    blocks: blocks(),
  })

  // The signed-in reader: the application bar is the chrome.
  await page.goto(`/w/${seed.workspaceId}/d/${document.id}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Section 1' })).toBeVisible()
  await walkBothWays(page, page.url(), 'header')
})
