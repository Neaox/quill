import { expect, test, type Page } from '@playwright/test'

import { seedDevelopmentData } from './support/seed.ts'

/**
 * Presenting a seeded document to a room: open it from the reading view, step
 * through its sections with the keyboard alone, jump to one by name, and leave
 * back to the section that was on screen (quill-plan.md section 14).
 *
 * It runs against the seeded server, so what is presented — a design document
 * with an opening, a callout, a code block, a table, and a numbered list — is
 * a document a person would actually stand up and talk through.
 */

/**
 * The Instrument artboard's width, for the same reason `journey.spec.ts` uses
 * it: the reading grid collapses on the width of its own container (ADR-027),
 * and the breakout widths only exist above that threshold.
 */
const VIEWPORT = { width: 1440, height: 900 }
test.use({ viewport: VIEWPORT })

/**
 * Browser-specific behaviour these journeys account for:
 *
 * - **Firefox and WebKit cancel a document load that a client-side navigation
 *   overtakes** (`NS_BINDING_ABORTED`, "Frame load interrupted"), so `signIn`
 *   waits for the page the router settled on before the next `page.goto`.
 * - **Full screen is the presentation's real width, and Firefox's full screen
 *   is the screen rather than the emulated viewport** — 1366px on the machine
 *   this runs on, not the 1440 configured above. "Full takes the whole screen"
 *   is therefore asked of the screen the browser actually has, which is what
 *   the assertion means anyway.
 * - **Escape inside full screen belongs to the browser.** Chromium hands the
 *   key to the page as well; Firefox and WebKit swallow it, so what proves
 *   "the presenter leaves" is where they land, not which listener ran.
 */

/** The width the document is really being laid out in, full screen included. */
async function screenWidth(page: Page): Promise<number> {
  return page.evaluate(() => globalThis.document.documentElement.clientWidth)
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: false }).fill(email)
  await page.getByLabel('Password', { exact: false }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The page the router settled on, not the address bar: see the note at the
  // top of the file.
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(page).toHaveURL('/')
}

/** Opens a seeded document from the workspace tree and starts presenting it. */
async function present(page: Page, workspaceId: string, title: string): Promise<void> {
  await page.goto(`/w/${workspaceId}`)
  await page
    .getByRole('navigation', { name: 'Documents' })
    .getByRole('link', { name: title })
    .click()
  await expect(page.getByRole('article', { name: title })).toBeVisible()
  await page.getByRole('link', { name: 'Present' }).click()
  await expect(page).toHaveURL(/\/present$/)
  // The route is its own chunk (quill-plan.md section 31), so the first step
  // being on screen is what says the presentation has actually started.
  await expect(onScreen(page)).toBeVisible()
}

/** The section the room is looking at: the one that is not hidden. */
function onScreen(page: Page) {
  return page.locator('main > section:not([hidden])')
}

test('a document is presented to a room with the keyboard', async ({ page }) => {
  const seed = seedDevelopmentData()

  await signIn(page, seed.adminEmail, seed.adminPassword)
  await present(page, seed.workspaceId, 'Authentication architecture')

  // The presentation opens on the document's own title and standfirst, with
  // one mark per section in the rail and the progress bar saying where we are.
  await expect(onScreen(page)).toHaveAttribute('aria-label', 'Authentication architecture')
  await expect(onScreen(page).getByText('Every request to the platform')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button')).toHaveCount(
    4,
  )
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Section 1 of 4')

  // The type is the projector's, not the page's: the reading size is raised
  // once, on the surface, and the whole document scales from it.
  const readingSize = await onScreen(page)
    .locator('article.prose')
    .evaluate((element) => globalThis.getComputedStyle(element).fontSize)
  expect(readingSize).toBe('27px')

  // --- Stepping ------------------------------------------------------------
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/\?step=2$/)
  await expect(onScreen(page)).toHaveAttribute('aria-label', 'Token shape')
  // The same renderer output the reading view mounts, carrying the ranges the
  // server packed at publish; Chromium paints them through `CSS.highlights`,
  // so what is asserted here is the attribute, not a span (ADR-030).
  await expect(onScreen(page).locator('pre code[data-tokens]').first()).toBeAttached()

  await page.keyboard.press('PageDown')
  await expect(page).toHaveURL(/\?step=3$/)
  await expect(onScreen(page)).toHaveAttribute('aria-label', 'Key rotation')

  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(/\?step=2$/)

  await page.keyboard.press('End')
  await expect(page).toHaveURL(/\?step=4$/)
  await expect(onScreen(page)).toHaveAttribute('aria-label', 'Failure modes')
  // The end is the end: a presentation never wraps back round to the title.
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/\?step=4$/)

  // --- A shared link lands on the section it names -------------------------
  await page.goto(`${new URL(page.url()).pathname}?step=3`)
  await expect(onScreen(page)).toHaveAttribute('aria-label', 'Key rotation')

  // --- Go to ---------------------------------------------------------------
  await page.keyboard.press('g')
  const goTo = page.getByRole('dialog', { name: 'Go to a section' })
  await expect(goTo).toBeVisible()
  await expect(goTo.getByRole('combobox', { name: 'Filter sections' })).toBeFocused()

  await page.keyboard.type('failure')
  await expect(goTo.getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(goTo).toBeHidden()
  await expect(onScreen(page)).toHaveAttribute('aria-label', 'Failure modes')

  // --- Presenter notes -----------------------------------------------------
  await page.keyboard.press('n')
  const notes = page.getByRole('complementary', { name: 'Presenter notes' })
  await expect(notes).toBeVisible()
  // The seeded document carries no `:::notes`, and the panel says so rather
  // than showing an empty card. What M4 will build is disabled, with its
  // reason beside it (`docs/design/feedback.md`).
  await expect(notes.getByText('No presenter notes for this section')).toBeVisible()
  await expect(notes.getByRole('button', { name: 'Note for later' })).toBeDisabled()
  await page.keyboard.press('n')
  await expect(notes).toBeHidden()

  // --- The chrome gets out of the way, and comes back ----------------------
  const bar = page.locator('.present-bar')
  await expect(bar).toHaveAttribute('data-idle', '')
  await page.mouse.move(700, 500)
  await expect(bar).not.toHaveAttribute('data-idle', '')

  // --- Leaving, at the section that was on screen --------------------------
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/#.*failure-modes$/)
  await expect(page.getByRole('article', { name: 'Authentication architecture' })).toBeVisible()
})

test('wide and full blocks use the whole screen', async ({ page }) => {
  const seed = seedDevelopmentData()

  await signIn(page, seed.adminEmail, seed.adminPassword)
  await present(page, seed.workspaceId, 'Reading surface tour')

  await page.keyboard.press('g')
  const goTo = page.getByRole('dialog', { name: 'Go to a section' })
  await expect(goTo.getByRole('combobox', { name: 'Filter sections' })).toBeFocused()
  await page.keyboard.type('layout widths')
  await page.keyboard.press('Enter')
  await expect(onScreen(page)).toHaveAttribute('aria-label', 'Layout widths')

  const measure = page.locator('.present-step:not([hidden]) article.prose')
  // A grid item at the reading measure: the step's own heading, which is a
  // direct child of the grid and asks for no breakout.
  const content = await measure.locator(':scope > h2').first().boundingBox()
  const wide = await measure.locator('.layout-wide').first().boundingBox()
  const full = await measure.locator('.layout-full').first().boundingBox()

  // Both breakout widths take the projector, and the reading measure does not:
  // `full` is the screen, `wide` the screen but for its gutter (ADR-027 plus
  // `present.css`), and the measure stays the measure.
  const screen = await screenWidth(page)
  expect(full?.width).toBeGreaterThan(screen - 4)
  expect(wide?.width).toBeGreaterThan(screen * 0.8)
  expect(wide?.width).toBeLessThan(screen)
  expect(content?.width ?? screen).toBeLessThan(1000)
})
