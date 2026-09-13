import { randomUUID } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { collectionId, heading, paragraph, publishDocument } from './support/content.ts'
import { seedDevelopmentData } from './support/seed.ts'

/**
 * Sharing a document with somebody outside the organisation, and closing the
 * door again (use cases 24, 25 and 26; plan section 14).
 *
 * The whole point of a share link is that it works for a person who is not
 * signed in and has never heard of this instance, so the reader here is a
 * **fresh browser context with no cookies at all** — not the same page with
 * the session cleared, which would still carry whatever storage the
 * application left behind. What that context can and cannot see is the
 * journey.
 *
 * The document is created by this test rather than taken from the seed, and
 * given a unique title, because the four browser profiles run this spec
 * against one database at the same time: a shared document would give each
 * profile a link list holding the other three's links, and "revoke the link
 * I just made" would be whichever one happened to be newest.
 */

/** Wide enough for the reading grid's breakout widths (ADR-027). */
test.use({ viewport: { width: 1440, height: 900 } })

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: false }).fill(email)
  await page.getByLabel('Password', { exact: false }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The page the router settled on, not the address bar: a client-side
  // navigation that overtakes a document load is cancelled on Firefox and
  // WebKit (see `present.spec.ts`).
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
}

/** The one row in the link list, addressed by what the link opens. */
function linkRow(dialog: Locator, opens: string): Locator {
  return dialog.getByRole('listitem').filter({ hasText: opens })
}

/**
 * Creates a link on the open document through the dialog, and answers with
 * the address — which is shown once and nowhere else.
 */
async function createLink(page: Page, title: string, opens: string): Promise<string> {
  await page.getByRole('button', { name: 'Share' }).click()
  const dialog = page.getByRole('dialog', { name: `Share “${title}”` })
  await expect(dialog).toBeVisible()

  const form = dialog.getByRole('form', { name: 'Create a link' })
  await form.getByLabel('What it opens').selectOption({ label: opens })
  await form.getByRole('button', { name: 'Create link' }).click()

  const address = dialog.getByLabel('Share link')
  await expect(address).toBeVisible()
  const url = await address.inputValue()
  expect(url).toContain('/share/')

  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()
  return url
}

test('a document is shared outside the organisation, read, and then closed', async ({
  browser,
  page,
}) => {
  const seed = seedDevelopmentData()
  const title = `Supplier handover ${randomUUID().slice(0, 8)}`

  await signIn(page, seed.adminEmail, seed.adminPassword)

  // This profile's own document, published through the same three calls the
  // application makes, so its link list holds this test's links and no others.
  const architecture = await collectionId(page.request, seed.workspaceId, 'Architecture')
  const document = await publishDocument(page.request, {
    workspaceId: seed.workspaceId,
    collectionId: architecture,
    title,
    blocks: [
      heading(1, title),
      paragraph('What the supplier needs to know before the engagement starts.'),
      heading(2, 'Scope'),
      paragraph('Two regions, one runbook, and a review at the end of each week.'),
    ],
  })

  await page.goto(`/w/${seed.workspaceId}/d/${document.id}`)
  await expect(page.getByRole('article', { name: title })).toBeVisible()

  // --- Creating the link ---------------------------------------------------
  await page.getByRole('button', { name: 'Share' }).click()
  const dialog = page.getByRole('dialog', { name: `Share “${title}”` })
  await expect(dialog).toBeVisible()

  const form = dialog.getByRole('form', { name: 'Create a link' })
  await form.getByLabel('What it opens').selectOption({ label: 'This document' })
  await form.getByLabel('Expires').selectOption({ label: 'In 30 days' })
  // View is the only role this release carries, so the form states it rather
  // than offering a control with one choice (plan section 14). Read from the
  // form, not the dialog: the list beside it names each link's role too.
  await expect(form.getByText('Viewer')).toBeVisible()
  await form.getByRole('button', { name: 'Create link' }).click()

  // The address is answered exactly once: only the token's SHA-256 is stored.
  const address = dialog.getByLabel('Share link')
  await expect(address).toBeVisible()
  await expect(dialog.getByText(/only time it is shown/)).toBeVisible()
  const url = await address.inputValue()
  expect(url).toContain('/share/')

  // The address can always be taken by hand: the field is focusable and its
  // value is the whole link, which is what a browser that refuses the
  // clipboard leaves a person with.
  await address.focus()
  await expect(address).toBeFocused()

  // Pressing Copy always says what happened. Which of the two it says is the
  // browser's to decide — WebKit grants an automated context no
  // clipboard-write permission — and the refusal is a real answer, naming the
  // alternative rather than leaving the press silent
  // (`docs/design/feedback.md`: nothing interactive is inert). Asserting one
  // outcome would be asserting a permission, not the product.
  await dialog.getByRole('button', { name: 'Copy' }).click()
  await expect(dialog.getByRole('status')).toHaveText(
    /copied to the clipboard|Select the address and copy it/,
  )

  // One link on this document, and it says what it opens and when it runs out.
  const row = linkRow(dialog, 'This document')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Expires')
  await expect(row).toContainText('never opened')

  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()

  // --- Reading it as a stranger --------------------------------------------
  const stranger = await browser.newContext()
  const strangerPage = await stranger.newPage()
  await strangerPage.goto(url)

  await expect(strangerPage.getByRole('article', { name: title })).toBeVisible()
  await expect(strangerPage.getByRole('banner')).toContainText('Shared with you')
  // No session was needed, and none was offered: a cold anonymous request is
  // answered with the page (`docs/product/surfaces.md`).
  expect(await stranger.cookies()).toEqual([])
  await expect(strangerPage.getByRole('link', { name: 'Edit' })).toHaveCount(0)
  await expect(
    strangerPage.getByRole('navigation', { name: 'Documents', exact: true }),
  ).toHaveCount(0)
  await expect(strangerPage.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
  // In no index and in no sitemap.
  await expect(strangerPage.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, nofollow',
  )

  // --- Revoking it ---------------------------------------------------------
  await page.getByRole('button', { name: 'Share' }).click()
  await expect(dialog).toBeVisible()
  // The address is gone: reopening Share cannot show a token the server will
  // never answer with again.
  await expect(dialog.getByLabel('Share link')).toHaveCount(0)

  await row.getByRole('button', { name: 'Revoke' }).click()
  const confirm = page.getByRole('dialog', { name: 'Revoke this link?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Revoke' }).click()
  await expect(confirm).toBeHidden()
  await expect(row).toContainText('Revoked')
  await expect(row.getByRole('button', { name: 'Revoke' })).toHaveCount(0)

  // --- And it is closed, on the very next request --------------------------
  const afterwards = await browser.newContext()
  const afterwardsPage = await afterwards.newPage()
  await afterwardsPage.goto(url)

  await expect(
    afterwardsPage.getByRole('heading', { name: 'This link is not available' }),
  ).toBeVisible()
  // Nothing about the content, and no way into the application: the refusal
  // is the same one an unknown token gets.
  await expect(afterwardsPage.getByText(title)).toHaveCount(0)
  await expect(afterwardsPage.getByRole('link')).toHaveCount(0)

  await stranger.close()
  await afterwards.close()
})

test('a subtree link opens the documents under it, and nothing around them', async ({
  browser,
  page,
}) => {
  const seed = seedDevelopmentData()
  const suffix = randomUUID().slice(0, 8)
  const parentTitle = `Engagement pack ${suffix}`
  const childTitle = `Weekly review ${suffix}`

  await signIn(page, seed.adminEmail, seed.adminPassword)

  const architecture = await collectionId(page.request, seed.workspaceId, 'Architecture')
  const parent = await publishDocument(page.request, {
    workspaceId: seed.workspaceId,
    collectionId: architecture,
    title: parentTitle,
    blocks: [heading(1, parentTitle), paragraph('Everything the supplier is given, in one place.')],
  })
  await publishDocument(page.request, {
    workspaceId: seed.workspaceId,
    collectionId: architecture,
    parentId: parent.id,
    title: childTitle,
    blocks: [heading(1, childTitle), paragraph('What is covered in each weekly review.')],
  })

  await page.goto(`/w/${seed.workspaceId}/d/${parent.id}`)
  await expect(page.getByRole('article', { name: parentTitle })).toBeVisible()
  const url = await createLink(page, parentTitle, 'This document and everything under it')

  // --- The stranger reads the target, then moves inside the link's scope ---
  const stranger = await browser.newContext()
  const reader = await stranger.newPage()
  await reader.goto(url)
  await expect(reader.getByRole('article', { name: parentTitle })).toBeVisible()

  const navigation = reader.getByRole('navigation', { name: 'Shared documents' })
  await expect(navigation).toBeVisible()
  await navigation.getByRole('link', { name: childTitle }).click()

  await expect(reader.getByRole('article', { name: childTitle })).toBeVisible()
  // The address is the document's reference — the title's words and its short
  // key — not a bare id (ADR-035).
  await expect(reader).toHaveURL(/\/share\/[^/]+\/d\/weekly-review-.+-[0-9a-hjkmnp-tv-z]{10}$/)
  // The chrome did not move: one link, one header, one set of terms.
  await expect(reader.getByRole('banner')).toContainText('Shared with you')
  await expect(navigation).toBeVisible()
  // And still nothing from the signed-in world.
  await expect(reader.getByRole('navigation', { name: 'Documents', exact: true })).toHaveCount(0)
  await expect(reader.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
  expect(await stranger.cookies()).toEqual([])

  await stranger.close()
})
