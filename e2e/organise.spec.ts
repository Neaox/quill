import { randomUUID } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { caretAtEndOf } from './support/editing.ts'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './support/seed.ts'

/**
 * The organise journey: M2's acceptance question, answered through the
 * interface and nothing else.
 *
 * "Can I add new workspaces, add new docs, nest them, move things around,
 * create folders, update documents, all in a clean and intuitive way?" —
 * every step here is a real click on a real control, and the tree is asserted
 * after each one, because the tree is where a person checks that what they
 * asked for happened.
 *
 * Nothing is created through the API: a fixture would prove the API, and the
 * API is proven elsewhere. This proves the product.
 */

/**
 * Browser-specific behaviour this journey accounts for:
 *
 * - **Firefox and WebKit cancel a document load that a client-side navigation
 *   overtakes** (`NS_BINDING_ABORTED`, "Frame load interrupted"). `signIn`
 *   waits for the page the router settled on rather than for the address bar,
 *   so the `page.goto` after it is not racing the home route's redirect.
 * - **"The end of the document" is an engine's opinion**, and a key pressed
 *   before the editing surface holds the focus reaches nothing, so the writing
 *   step puts the caret in a named block once the surface is focused.
 */

/**
 * Serial, and given a journey's budget rather than a test's: the first of the
 * three is a unit, a workspace, two collections, four documents, two renames,
 * a move and two deletions, all through the interface. Thirty seconds is what
 * Playwright allows one assertion to go wrong in, and the slower engines need
 * more of it than Chromium for the same sequence.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 })

/** Wide enough for the shell's four columns; the phone width has its own check below. */
test.use({ viewport: { width: 1440, height: 900 } })

/** Unique per run, so the journey can run twice against one instance. */
const suffix = randomUUID().slice(0, 8)
const UNIT = `Organise unit ${suffix}`
const WORKSPACE = `Organise ${suffix}`

/** The document tree itself: the landmark the collections and documents sit in. */
function tree(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Documents' })
}

/**
 * The sidebar around it, which also carries the workspace's heading and the
 * two controls that add to it. Both of those are unique on the page, so they
 * are reached by name rather than by a container with no landmark of its own.
 */
function newCollection(page: Page): Locator {
  return page.getByRole('button', { name: 'New collection' })
}

/** The shell's header bar, where the open document's own controls live. */
function header(page: Page): Locator {
  return page.getByRole('banner')
}

/**
 * The open actions menu.
 *
 * Its trigger lives in the tree row or the header bar it belongs to; the panel
 * itself is portalled to the end of the document, like every floating panel in
 * the design system, so it is reached from the page rather than from the
 * container the trigger sits in.
 */
function menu(page: Page): Locator {
  return page.getByRole('menu')
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: false }).fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: false }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Home, or straight into the only workspace there is: which one depends on
  // how many workspaces this instance already has, and neither is what this
  // journey is about. Both render the signed-in header and the sign-in page
  // does not, so waiting for it waits for whichever of the two the router
  // settled on — and the address bar is no substitute, because `/` is what it
  // says while `routes/index.tsx` is still deciding. A `page.goto` fired into
  // that gap is cancelled by the redirect that follows it: Firefox reports
  // `NS_BINDING_ABORTED`, WebKit "Frame load interrupted".
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(page).not.toHaveURL(/sign-in/)
}

/** Opens a dialog's field, replaces what is in it, and confirms. */
async function fillAndConfirm(dialog: Locator, label: string, value: string, confirm: string) {
  const field = dialog.getByLabel(label, { exact: false })
  await field.fill(value)
  await dialog.getByRole('button', { name: confirm }).click()
}

test('a unit, a workspace, collections, documents, nesting, moving and deleting', async ({
  page,
}) => {
  await signIn(page)

  // --- A unit, and a workspace inside it -----------------------------------
  await page.goto('/admin/organisation')
  await expect(page.getByRole('heading', { level: 1, name: 'Organisation' })).toBeVisible()

  await page.getByRole('button', { name: 'New unit' }).click()
  const unitDialog = page.getByRole('dialog', { name: 'New unit' })
  await fillAndConfirm(unitDialog, 'Name', UNIT, 'Create')
  await expect(page.getByText(UNIT, { exact: true })).toBeVisible()

  const unitRow = page.getByRole('listitem').filter({ hasText: UNIT }).first()
  await unitRow.getByRole('button', { name: 'New workspace' }).first().click()
  const workspaceDialog = page.getByRole('dialog', { name: `New workspace in ${UNIT}` })
  await workspaceDialog.getByLabel('Name', { exact: false }).fill(WORKSPACE)
  // The address is suggested from the name, and is what a published site is
  // addressed by, so it has to be unique across the instance.
  await expect(workspaceDialog.getByLabel('Address', { exact: false })).toHaveValue(
    `organise-${suffix}`,
  )
  await workspaceDialog.getByRole('button', { name: 'Create' }).click()

  await page.getByRole('link', { name: WORKSPACE }).click()
  await expect(page.getByRole('heading', { level: 1, name: WORKSPACE })).toBeVisible()

  // --- Two collections ------------------------------------------------------
  // The first one from the empty state, which is where a person actually is.
  await page.getByRole('button', { name: 'Create the first collection' }).click()
  await fillAndConfirm(
    page.getByRole('dialog', { name: 'New collection' }),
    'Name',
    'Guides',
    'Create',
  )
  await expect(tree(page).getByText('Guides', { exact: true })).toBeVisible()

  // The second from the "+" beside the workspace heading in the sidebar.
  await newCollection(page).click()
  await fillAndConfirm(
    page.getByRole('dialog', { name: 'New collection' }),
    'Name',
    'Archive',
    'Create',
  )
  await expect(tree(page).getByText('Archive', { exact: true })).toBeVisible()

  // --- A document, and a child nested under it ------------------------------
  await tree(page).getByRole('button', { name: 'New document in Guides' }).click()
  const newDocument = page.getByRole('dialog', { name: 'New document' })
  await expect(newDocument.getByLabel('Collection')).toHaveValue(/.+/)
  await fillAndConfirm(newDocument, 'Title', 'Quarterly plan', 'Create')
  await expect(page.getByRole('heading', { level: 1, name: 'Quarterly plan' })).toBeVisible()
  await expect(tree(page).getByRole('link', { name: 'Quarterly plan' })).toBeVisible()

  await tree(page).getByRole('button', { name: 'More actions for Quarterly plan' }).click()
  await menu(page).getByRole('menuitem', { name: 'New child document' }).click()
  const newChild = page.getByRole('dialog', { name: 'New document' })
  await fillAndConfirm(newChild, 'Title', 'Appendix', 'Create')
  await expect(page.getByRole('heading', { level: 1, name: 'Appendix' })).toBeVisible()

  // Nesting is the tree's structure: the child's row is inside the parent's.
  const parentItem = tree(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: 'Quarterly plan' }) })
    .first()
  await expect(parentItem.getByRole('link', { name: 'Appendix' })).toBeVisible()

  // --- Rename both ----------------------------------------------------------
  await header(page).getByRole('button', { name: 'Rename "Appendix"' }).click()
  await page.getByLabel('Document title').fill('Appendix A')
  await header(page).getByRole('button', { name: 'Save' }).click()
  await expect(tree(page).getByRole('link', { name: 'Appendix A' })).toBeVisible()

  await tree(page).getByRole('link', { name: 'Quarterly plan' }).click()
  await header(page).getByRole('button', { name: 'Rename "Quarterly plan"' }).click()
  await page.getByLabel('Document title').fill('Quarterly plan 2026')
  await header(page).getByRole('button', { name: 'Save' }).click()
  await expect(tree(page).getByRole('link', { name: 'Quarterly plan 2026' })).toBeVisible()

  // --- Write it and publish it ----------------------------------------------
  // After the renames, where use case 8 puts it: a publish carries the name
  // the document has now, rather than restoring the one it was created with.
  await tree(page).getByRole('link', { name: 'Appendix A' }).click()
  // The shell keeps the page it is leaving on screen until the next one's
  // loader resolves (a progress bar, not a blank), so the header — and its
  // Edit link — is still "Quarterly plan 2026"'s until this has landed.
  // Never published yet, so what lands is the page's own title, not an article.
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1, name: 'Appendix A' }),
  ).toBeVisible()
  await header(page).getByRole('link', { name: 'Edit' }).click()
  const surface = page.getByRole('textbox', { name: 'Appendix A' })
  await expect(surface).toBeVisible()
  // From the end of the document's own title heading, which the rename has
  // just rewritten (`support/editing.ts` for why that is not simply a click).
  const titleHeading = surface.getByRole('heading', { level: 1 }).first()
  await expect(titleHeading).toHaveText('Appendix A')
  await caretAtEndOf(surface, titleHeading)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Everything that did not fit in the plan.')
  await expect(page.getByText('draft saved')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Publish' }).click()

  const published = page.getByRole('article', { name: 'Appendix A' })
  await expect(published).toBeVisible()
  await expect(published.getByText(/did not fit in the plan/)).toBeVisible()
  // The rename survived the publish: the tree still says what it was renamed to.
  await expect(tree(page).getByRole('link', { name: 'Appendix A' })).toBeVisible()

  // --- Move the child into the other collection -----------------------------
  await tree(page).getByRole('link', { name: 'Appendix A' }).click()
  await header(page).getByRole('button', { name: 'More actions for Appendix A' }).click()
  await menu(page).getByRole('menuitem', { name: 'Move to…' }).click()
  const move = page.getByRole('dialog', { name: 'Move to…' })
  await move.getByRole('button', { name: 'Top level of Archive' }).click()
  // Exact: the document being moved is now correctly marked as a destination
  // it cannot be moved into, and the reason beside it ("Would move the …")
  // puts the word in a second button's accessible name.
  await move.getByRole('button', { name: 'Move', exact: true }).click()

  // It has left Guides and arrived in Archive, at the top level of it.
  const archiveSection = tree(page)
    .locator('div')
    .filter({ has: page.getByText('Archive', { exact: true }) })
    .first()
  await expect(archiveSection.getByRole('link', { name: 'Appendix A' })).toBeVisible()
  await expect(parentItem.getByRole('link', { name: 'Appendix A' })).toBeHidden()

  // --- Delete the child ------------------------------------------------------
  await header(page).getByRole('button', { name: 'More actions for Appendix A' }).click()
  await menu(page).getByRole('menuitem', { name: 'Delete…' }).click()
  const confirmDelete = page.getByRole('dialog', { name: /Delete .Appendix A/ })
  await expect(confirmDelete).toBeVisible()
  await confirmDelete.getByRole('button', { name: 'Delete' }).click()

  // Back at the workspace, told what happened, and gone from the tree.
  await expect(page.getByRole('heading', { level: 1, name: WORKSPACE })).toBeVisible()
  await expect(page.getByText('Deleted Appendix A')).toBeVisible()
  await expect(tree(page).getByRole('link', { name: 'Appendix A' })).toBeHidden()

  // --- Delete the collection it left behind ----------------------------------
  await tree(page).getByRole('button', { name: 'More actions for Archive' }).click()
  await menu(page).getByRole('menuitem', { name: 'Delete…' }).click()
  const deleteCollection = page.getByRole('dialog', { name: /Delete .Archive/ })
  await deleteCollection.getByRole('button', { name: 'Delete' }).click()

  await expect(tree(page).getByText('Archive', { exact: true })).toBeHidden()
  await expect(tree(page).getByText('Guides', { exact: true })).toBeVisible()
  await expect(tree(page).getByRole('link', { name: 'Quarterly plan 2026' })).toBeVisible()
})

test('a collection that still holds documents says so instead of being deleted', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/admin/organisation')
  await page.getByRole('link', { name: WORKSPACE }).click()

  await tree(page).getByRole('button', { name: 'More actions for Guides' }).click()
  await menu(page).getByRole('menuitem', { name: 'Delete…' }).click()

  const dialog = page.getByRole('dialog', { name: /Delete .Guides/ })
  await expect(dialog.getByText(/still holds/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Move documents first' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Delete' })).toHaveCount(0)
})

test('the organise controls are reachable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page)
  await page.goto('/admin/organisation')
  await page.getByRole('link', { name: WORKSPACE }).click()

  // The sidebar stacks above the page at this width rather than disappearing,
  // so every organise entry point is still there.
  await expect(newCollection(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible()
  await expect(tree(page).getByRole('link', { name: 'Quarterly plan 2026' })).toBeVisible()
})
