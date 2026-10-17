import { randomUUID } from 'node:crypto'

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { accountMenu } from './support/account.ts'
import { collectionId, heading, paragraph, publishDocument } from './support/content.ts'
import { BROWSER_HEADERS } from './support/fixtures.ts'
import { seedDevelopmentData } from './support/seed.ts'

/**
 * Reviewing what a draft holds that the published page does not: the notice above the
 * page, the draft previewed as a reader would meet it, the comparison of the published
 * page with the draft (who made each change, the characters a changed word changed),
 * and one change reverted in the draft and the revert undone.
 */

test.describe.configure({ timeout: 90_000 })
test.use({ viewport: { width: 1440, height: 900 } })

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: false }).fill(email)
  await page.getByLabel('Password', { exact: false }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(accountMenu(page)).toBeVisible()
  await expect(page).toHaveURL('/')
}

/** Saves the draft as the editor would: take the lock, write, let it go. */
async function saveDraft(
  request: APIRequestContext,
  documentId: string,
  title: string,
  blocks: readonly object[],
): Promise<void> {
  await request.post(`/api/documents/${documentId}/lock/acquire`, {
    headers: BROWSER_HEADERS,
    data: {},
  })
  const draft = (await (
    await request.get(`/api/documents/${documentId}/draft`, { headers: BROWSER_HEADERS })
  ).json()) as { draftVersion: number }
  const saved = await request.put(`/api/documents/${documentId}/draft`, {
    headers: BROWSER_HEADERS,
    data: {
      expectedVersion: draft.draftVersion,
      ast: { version: 1, frontMatter: { title }, ast: { type: 'root', children: blocks } },
    },
  })
  expect(saved.ok()).toBe(true)
  await request.delete(`/api/documents/${documentId}/lock`, { headers: BROWSER_HEADERS })
}

test('unpublished changes are noticed, previewed, compared, reverted, and the revert undone', async ({
  page,
}) => {
  const seed = seedDevelopmentData()
  await signIn(page, seed.adminEmail, seed.adminPassword)

  const architecture = await collectionId(page.request, seed.workspaceId, 'Architecture')
  const title = `Cache policy ${randomUUID().slice(0, 8)}`
  const published = await publishDocument(page.request, {
    workspaceId: seed.workspaceId,
    collectionId: architecture,
    title,
    blocks: [
      heading(1, title),
      paragraph('The colour of a stale entry is grey.'),
      paragraph('Entries expire after an hour.'),
    ],
  })
  await saveDraft(page.request, published.id, title, [
    heading(1, title),
    paragraph('The color of a stale entry is grey.'),
    paragraph('Entries expire after a day.'),
  ])

  // --- The notice above the page, and the draft as a reader will see it -----
  await page.goto(`/w/${seed.workspaceId}/d/${published.id}`)
  const notice = page.getByRole('group', { name: 'Note: You have unpublished changes' })
  await expect(notice).toBeVisible()
  const preview = notice.getByRole('link', { name: /your unpublished changes/u })
  await expect(preview).toHaveAttribute('href', /\?draft$/u)
  const previewPage = await page.context().newPage()
  await previewPage.goto((await preview.getAttribute('href')) ?? '')
  await expect(previewPage.getByText('Entries expire after a day.')).toBeVisible()
  await expect(previewPage.getByText('Unpublished changes')).toBeVisible()
  await previewPage.close()

  // --- The comparison of the published page with the draft -----------------
  await page.goto(`/w/${seed.workspaceId}/d/${published.id}?from=${published.revision}&to=draft`)
  const changes = page.getByRole('navigation', { name: /^Changes \(\d+\)$/u })
  await expect(changes).toBeVisible()
  // Who made each change, from the record the draft keeps.
  await expect(changes.getByText(/·/u).first()).toBeVisible()
  // Within a word, the character that changed is marked.
  const article = page.getByRole('article').first()
  await expect(article.locator('del[data-diff] [data-diff-char]').first()).toHaveText('u')

  // --- One change reverted, and the revert undone --------------------------
  await expect(changes.getByRole('button', { name: /^Revert/u })).toHaveCount(2)
  const revertDay = changes.getByRole('button', { name: /^Revert: .*after a day/u })
  await expect(revertDay).toBeEnabled()
  await revertDay.click()
  await expect(page.getByText('Change reverted in your draft')).toBeVisible()
  await expect(changes.getByRole('button', { name: /^Revert/u })).toHaveCount(1)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Change restored to your draft')).toBeVisible()
  await expect(changes.getByRole('button', { name: /^Revert/u })).toHaveCount(2)
})
