import { expect, test, type Page } from '@playwright/test'

import { signInAsAdmin } from './support/admin.ts'

/**
 * Use case 20: find the runbook during an incident
 * (`docs/product/use-cases.md`).
 *
 * Three in the morning, something is down, and the phrase in somebody's head
 * is half-remembered. Every step here is a real key press or click on a real
 * control; nothing is fetched through the API.
 *
 * What the seed gives this journey (`apps/server/src/scripts/seed.ts`):
 *
 * - **Engineering** (`engineering`), which holds *Regional failover*, a
 *   runbook whose body is full of the word.
 * - **Platform docs** (`platform-docs`), a second workspace under a second
 *   unit, which holds *Platform team charter* — and "charter" appears in no
 *   Engineering document, so a search for it from Engineering can only be
 *   answered from somewhere else. That is what proves the grouping rather
 *   than merely exercising it.
 *
 * The admin account can read both, which is the point: search is the one
 * surface that crosses workspaces (quill-plan.md §15).
 */

/** Wide enough for the shell's four columns and the top bar's search field. */
test.use({ viewport: { width: 1440, height: 900 } })

const ENGINEERING = 'engineering'

/**
 * Signs the browser's own context in, so the pages this journey opens carry
 * the session: `signInAsAdmin` sends the fetch metadata and `Origin` a real
 * browser would, which the CSRF defence requires of a state-changing request
 * (`e2e/support/fixtures.ts`).
 */
async function signIn(page: Page): Promise<void> {
  await signInAsAdmin(page.context().request)
}

/** The palette's own field, which is the one that gets typed into. */
function queryBox(page: Page) {
  return page.getByRole('combobox', { name: 'Search documentation' })
}

test.describe('search', () => {
  test('finds the runbook from the top bar, and opens it', async ({ page }) => {
    await signIn(page)
    await page.goto(`/w/${ENGINEERING}`)

    await page.getByRole('banner').getByRole('button', { name: 'Search documentation' }).click()
    await expect(page.getByRole('dialog', { name: 'Search documentation' })).toBeVisible()

    await queryBox(page).fill('failover')

    const here = page.getByRole('group', { name: 'In this workspace' })
    await expect(here.getByRole('option', { name: /Regional failover/ })).toBeVisible()
    // The snippet marks the matched words, from offsets rather than from
    // anything the server rendered (ADR-010).
    await expect(here.locator('mark').first()).toHaveText(/failover/i)

    await here.getByRole('option', { name: /Regional failover/ }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Regional failover' })).toBeVisible()
    // The readable address (ADR-035): the title's words, then the short key.
    await expect(page).toHaveURL(/\/w\/engineering\/d\/regional-failover-[0-9a-hjkmnp-tv-z]{10}$/)
  })

  test('opens on Ctrl+K from wherever focus is, and closes on Escape', async ({ page }) => {
    await signIn(page)
    await page.goto(`/w/${ENGINEERING}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.keyboard.press('ControlOrMeta+k')
    await expect(queryBox(page)).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Search documentation' })).toBeHidden()
  })

  test('reaches a result with the keyboard alone', async ({ page }) => {
    await signIn(page)
    await page.goto(`/w/${ENGINEERING}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.keyboard.press('ControlOrMeta+k')
    await queryBox(page).fill('failover')
    await expect(page.getByRole('option').first()).toBeVisible()

    // The arrows move the active option; focus stays in the field throughout,
    // which is what makes the palette usable without ever reaching for a mouse.
    await page.keyboard.press('ArrowDown')
    await expect(queryBox(page)).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/d\//)
  })

  test('offers a match from another workspace under that workspace’s name', async ({ page }) => {
    await signIn(page)
    await page.goto(`/w/${ENGINEERING}`)

    await page.keyboard.press('ControlOrMeta+k')
    // "charter" is in the Platform docs workspace and in no Engineering
    // document, so every answer has to come from elsewhere.
    await queryBox(page).fill('charter')

    const elsewhere = page.getByRole('group', { name: 'Platform docs' })
    await expect(elsewhere.getByRole('option', { name: /Platform team charter/ })).toBeVisible()
    await expect(page.getByRole('group', { name: 'In this workspace' })).toBeHidden()

    await elsewhere.getByRole('option', { name: /Platform team charter/ }).click()

    await expect(
      page.getByRole('heading', { level: 1, name: 'Platform team charter' }),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/w\/platform-docs\/d\//)
  })

  test('says so, without failing, when nothing matches', async ({ page }) => {
    await signIn(page)
    await page.goto(`/w/${ENGINEERING}`)

    await page.keyboard.press('ControlOrMeta+k')
    await queryBox(page).fill('zzzqqqnothinghere')

    await expect(page.getByText(/Nothing matched/)).toBeVisible()
    await expect(page.getByRole('option')).toHaveCount(0)
  })

  test('points at the character a query could not be read past', async ({ page }) => {
    await signIn(page)
    await page.goto(`/w/${ENGINEERING}`)

    await page.keyboard.press('ControlOrMeta+k')
    // A filter with nothing after its colon: one of the three refusals the
    // API answers with `422 invalid_query` and a position
    // (`docs/architecture/api-contract-m2.md`).
    await queryBox(page).fill('owner:')

    await expect(page.getByRole('alert')).toContainText('This filter has nothing after its colon')
    await expect(page.getByRole('alert')).toContainText('at character')
  })

  test('carries the query to the results page, which pages and can be shared', async ({ page }) => {
    await signIn(page)
    await page.goto(`/w/${ENGINEERING}`)

    await page.keyboard.press('ControlOrMeta+k')
    await queryBox(page).fill('failover')
    await expect(page.getByRole('option').first()).toBeVisible()
    await page.getByRole('link', { name: 'See all results' }).click()

    await expect(page).toHaveURL(/\/w\/engineering\/search\?q=failover$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'In this workspace' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Regional failover/ }).first()).toBeVisible()

    // The address alone is enough: a reload lands on the same results, which
    // is the whole reason the query is URL state (ADR-013).
    await page.reload()
    await expect(page.getByRole('link', { name: /Regional failover/ }).first()).toBeVisible()

    // The shell is still there — search is a page inside the workspace, not a
    // replacement for it (`docs/design/feedback.md`).
    await expect(page.getByRole('navigation', { name: 'Documents' })).toBeVisible()
  })

  test('refines the query from the results page itself', async ({ page }) => {
    await signIn(page)
    await page.goto(`/w/${ENGINEERING}/search?q=failover`)
    await expect(page.getByRole('link', { name: /Regional failover/ }).first()).toBeVisible()

    const box = page.getByRole('main').getByLabel('Search this organisation')
    await box.fill('charter')
    await page.getByRole('main').getByRole('button', { name: 'Search' }).click()

    await expect(page).toHaveURL(/\/w\/engineering\/search\?q=charter$/)
    await expect(page.getByRole('heading', { level: 2, name: 'Elsewhere' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'Platform docs' })).toBeVisible()
  })

  test('searches from outside a workspace too, grouping every match', async ({ page }) => {
    await signIn(page)
    await page.goto('/')

    await page.keyboard.press('ControlOrMeta+k')
    await queryBox(page).fill('failover')

    // No workspace is in scope, so nothing is "in this workspace": every match
    // is offered as a grouped suggestion instead
    // (`docs/architecture/api-contract-m2.md`).
    await expect(page.getByRole('option').first()).toBeVisible()
    await expect(page.getByRole('group', { name: 'In this workspace' })).toBeHidden()
    await expect(page.getByRole('group', { name: 'Engineering' })).toBeVisible()
  })

  test('works at a phone width, where the field is an icon', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await page.goto(`/w/${ENGINEERING}`)

    // The label is hidden at this width, so the control is named by its
    // attribute rather than by its contents.
    await page.getByRole('banner').getByRole('button', { name: 'Search documentation' }).click()
    await queryBox(page).fill('failover')

    await expect(page.getByRole('option', { name: /Regional failover/ })).toBeVisible()
    await page.getByRole('option', { name: /Regional failover/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Regional failover' })).toBeVisible()
  })
})
