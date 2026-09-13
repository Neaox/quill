import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import {
  code,
  collectionId,
  heading,
  paragraph,
  publishDocument,
  table,
  wide,
} from './support/content.ts'
import { caretAtEndOf } from './support/editing.ts'
import { seedDevelopmentData } from './support/seed.ts'

/**
 * The milestone journey: sign in, read, write, publish, read again, publish a
 * second revision, compare the two, restore the first, and see it.
 *
 * It runs against the seeded server — the same data `pnpm --filter
 * @quill/server seed` puts in a fresh instance — so what it proves is what a
 * person would see on their first day rather than what a fixture was built to
 * satisfy.
 */

/**
 * Browser-specific behaviour this journey accounts for:
 *
 * - **Firefox and WebKit cancel a document load that a client-side navigation
 *   overtakes** (`NS_BINDING_ABORTED`, "Frame load interrupted"). `signIn`
 *   therefore waits for the page the router settled on, not for the address
 *   bar, before the next `page.goto`.
 * - **"The end of the document" is an engine's opinion.** `Control+End` in a
 *   `contenteditable` stops at a different place in each of the four, and a
 *   key that arrives before the editing surface holds the focus is delivered
 *   nowhere at all. The writing steps therefore put the caret in a named block
 *   and press `End`, once the surface is focused.
 */

/**
 * The whole journey is one session; splitting it would prove less.
 *
 * And it is a journey rather than a test: sign in, read, create, write,
 * publish, edit, publish again, compare, restore — twenty-odd interactions
 * across two servers. Playwright's 30-second default is the budget for one
 * assertion going wrong, not for all of that, and Chromium fitting inside it
 * while Firefox and WebKit do not says nothing about the product.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 })

/**
 * The Instrument artboard's width. It matters: the reading grid collapses on
 * the width of the *main region*, not the window (ADR-027), and at Playwright's
 * default 1280 the rail, the tree, and the aside leave it under the threshold
 * where `wide` and `content` are still distinct — which is the grid behaving
 * correctly, and would make a breakout assertion here assert the opposite of
 * what it means to.
 */
test.use({ viewport: { width: 1440, height: 900 } })

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: false }).fill(email)
  await page.getByLabel('Password', { exact: false }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The signed-in header is rendered by the page sign-in lands on and by
  // nothing before it, so waiting for it waits for the router to have
  // *finished* — `routes/index.tsx` decides in `beforeLoad` whether home is
  // home or a redirect into the only workspace, and the address bar says `/`
  // throughout either. A `page.goto` fired into that gap is cancelled by
  // whatever the router does next: Firefox reports `NS_BINDING_ABORTED` and
  // WebKit "Frame load interrupted", where Chromium usually gets away with it.
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(page).toHaveURL('/')
}

/** The editing surface, which is a labelled textbox rather than a bare div. */
function surface(page: Page, title: string) {
  return page.getByRole('textbox', { name: title })
}

test('a document is written, published, revised, compared, and restored', async ({ page }) => {
  const seed = seedDevelopmentData()

  // --- Sign in -------------------------------------------------------------
  await signIn(page, seed.adminEmail, seed.adminPassword)

  // --- Read a seeded document ---------------------------------------------
  await page.goto(`/w/${seed.workspaceId}`)
  await page
    .getByRole('navigation', { name: 'Documents' })
    .getByRole('link', { name: 'Authentication architecture' })
    .click()

  const seeded = page.getByRole('article', { name: 'Authentication architecture' })
  await expect(seeded).toBeVisible()
  await expect(seeded.getByRole('heading', { name: /Token shape/ })).toBeVisible()

  // The code block carries the ranges the server packed at publish time, and
  // the client has painted them (ADR-030). Chromium has the CSS Custom
  // Highlight API, so the colour lives in `CSS.highlights` and the text node
  // is left alone — which is the whole point of the ranges backend.
  const codeBlock = seeded.locator('pre code[data-tokens]').first()
  await expect(codeBlock).toBeVisible()
  await expect.poll(async () => page.evaluate(() => CSS.highlights.size)).toBeGreaterThan(0)

  // Every table reads inside its own width, scrollable and reachable without
  // a pointer (ADR-027).
  const tableRegion = seeded.locator('.table-scroll').first()
  await expect(tableRegion).toHaveAttribute('role', 'group')

  // The outline is the document's own headings, and the timeline its publishes.
  await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Revisions' })).toBeVisible()

  // --- A document with a breakout table ------------------------------------
  const architecture = await collectionId(page.request, seed.workspaceId, 'Architecture')
  const breakout = await publishDocument(page.request, {
    workspaceId: seed.workspaceId,
    collectionId: architecture,
    title: `Latency budgets ${randomUUID().slice(0, 8)}`,
    blocks: [
      heading(1, 'Latency budgets'),
      paragraph('Every endpoint has a budget, and every budget has an owner.'),
      wide([
        table([
          ['Endpoint', 'Method', 'Budget', 'Owner', 'Region', 'Alarm'],
          ['/auth/token', 'POST', '120 ms', 'Identity', 'eu-west', 'p95 over budget'],
          ['/auth/refresh', 'POST', '80 ms', 'Identity', 'eu-west', 'p95 over budget'],
        ]),
      ]),
      code('ts', 'export const budgetMs = 120'),
    ],
  })

  await page.goto(`/w/${seed.workspaceId}/d/${breakout.id}`)
  const wideBlock = page
    .getByRole('article', { name: breakout.title })
    .locator('.layout-wide')
    .first()
  await expect(wideBlock).toBeVisible()

  // `wide` is a real breakout: the block is wider than the reading measure it
  // would otherwise have had.
  const widths = await wideBlock.evaluate((element) => ({
    block: element.getBoundingClientRect().width,
    measure: (element.previousElementSibling as HTMLElement).getBoundingClientRect().width,
  }))
  expect(widths.block).toBeGreaterThan(widths.measure)

  // --- Create a document ---------------------------------------------------
  const title = `Failover drill ${randomUUID().slice(0, 8)}`
  await page.goto(`/w/${seed.workspaceId}`)
  // Exactly the workspace's own control, not the "New document in Guides" one
  // beside every collection in the tree: by name alone this matches five
  // buttons once the tree has loaded, and which of those the click gets is a
  // question about how fast the tree arrived rather than about the product.
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New document' })
  await dialog.getByLabel('Title', { exact: false }).fill(title)
  await dialog.getByLabel('Collection').selectOption({ index: 1 })
  await dialog.getByRole('button', { name: 'Create' }).click()

  // A document with no revision yet is an empty state with a way forward.
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await page.getByRole('link', { name: 'Start writing' }).click()

  // --- Write it ------------------------------------------------------------
  // A new document opens on its own title, already its first heading, and a
  // writer carries on from the end of it (`support/editing.ts` for why that
  // is not simply a click).
  const titleHeading = surface(page, title).getByRole('heading', { level: 1 }).first()
  await expect(titleHeading).toHaveText(title)
  await caretAtEndOf(surface(page, title), titleHeading)

  await page.keyboard.press('Enter')
  await page.keyboard.type('Running the drill')
  await page.keyboard.press('Control+Alt+2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Run this drill once a quarter, in a working hour.')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+Alt+c')
  await page.keyboard.type('await failover.start({ region: "eu-west" })')

  await expect(page.getByText('draft saved')).toBeVisible({ timeout: 15_000 })

  // --- Publish it ----------------------------------------------------------
  await page.getByRole('button', { name: 'Publish' }).click()

  // --- Read it -------------------------------------------------------------
  const published = page.getByRole('article', { name: title })
  await expect(published).toBeVisible()
  await expect(published.getByRole('heading', { level: 1, name: /Failover drill/ })).toBeVisible()
  await expect(
    published.getByRole('heading', { level: 2, name: 'Running the drill' }),
  ).toBeVisible()
  await expect(published.getByText(/once a quarter/)).toBeVisible()
  await expect(published.locator('pre code')).toContainText('failover.start')

  // --- Edit it again, and publish a second revision ------------------------
  await page.getByRole('link', { name: 'Edit' }).click()
  await expect(surface(page, title)).toBeVisible()
  // To the end of the paragraph itself, rather than `Control+End` and a step
  // down from wherever a click in the middle of the canvas landed: "the end of
  // the document" is a different place in each engine's `contenteditable` —
  // Chromium stops in the last heading, Firefox goes on into the code block —
  // and which one it is was never what this step is about.
  await caretAtEndOf(
    surface(page, title),
    surface(page, title)
      .getByText(/once a quarter/)
      .first(),
  )
  await page.keyboard.type(' Tell the on-call engineer before you begin.')
  await expect(page.getByText('draft saved')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(published).toBeVisible()
  await expect(published.getByText(/on-call engineer/)).toBeVisible()

  // --- History -------------------------------------------------------------
  const revisions = page.getByRole('region', { name: 'Revisions' })
  await expect(revisions.getByRole('link', { name: /v2/ })).toBeVisible()
  await expect(revisions.getByRole('link', { name: /v1/ })).toBeVisible()

  // --- Compare the two revisions -------------------------------------------
  await page.getByText('Compare', { exact: true }).first().click()
  await page.getByLabel('From').selectOption({ index: 1 })
  await page.getByLabel('To').selectOption({ index: 0 })
  await page.getByRole('button', { name: 'Compare' }).click()

  await expect(page.getByRole('heading', { name: 'Comparing v1 with v2' })).toBeVisible()
  const diff = page.getByRole('group', { name: 'Unified diff' })
  await expect(diff).toContainText('on-call engineer')
  await expect(diff.locator('[data-change="added"]').first()).toBeVisible()

  // --- Restore the first revision ------------------------------------------
  await page.getByRole('link', { name: 'Back to the document' }).click()
  await revisions.getByRole('link', { name: /v1/ }).click()
  await expect(page.getByText(/reading v1/)).toBeVisible()

  await page.getByRole('button', { name: 'Restore this revision' }).click()
  const confirm = page.getByRole('dialog', { name: 'Restore v1' })
  await confirm.getByRole('button', { name: 'Restore' }).click()

  // --- See the restored content --------------------------------------------
  const restored = page.getByRole('article', { name: title })
  await expect(restored).toBeVisible()
  await expect(restored.getByText(/once a quarter/)).toBeVisible()
  await expect(restored.getByText(/on-call engineer/)).toBeHidden()
  // Restoring publishes rather than erasing: the step it undid is still there.
  await expect(revisions.getByRole('link', { name: /v3/ })).toBeVisible()
})
