import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { seedDevelopmentData } from './support/seed.ts'

test.describe('documents', () => {
  test('creates a document and sees it in the tree', async ({ page, isMobile }) => {
    const seed = seedDevelopmentData()
    const signIn = await page.context().request.post('/api/auth/sign-in', {
      data: { email: seed.adminEmail, password: seed.adminPassword },
    })
    expect(signIn.ok()).toBe(true)

    const title = `E2E runbook ${randomUUID().slice(0, 8)}`

    await page.goto(`/w/${seed.workspaceId}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // `exact`: the sidebar offers a "New document in <collection>" control on
    // every collection, and Playwright's `name` matches by substring.
    await page.getByRole('button', { name: 'New document', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New document' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Title', { exact: false }).fill(title)
    // The seeded workspace already has collections (`Architecture`,
    // `Decisions`, ...) — a document cannot be created without choosing one,
    // there being no route to create a collection yet.
    await dialog.getByLabel('Collection').selectOption({ index: 1 })
    await dialog.getByRole('button', { name: 'Create' }).click()

    // Creating navigates straight to the new document.
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    // A new document has a draft with its title and nothing written under it yet.
    await expect(page.getByRole('group', { name: 'Note: Nothing written yet' })).toBeVisible()

    // The navigation tree (`WorkspaceTree`, `@quill/ui`'s `Tree`) shows it,
    // marked as the current document. On a phone the tree is a sheet behind
    // the header's "Browse documents" (`document-shell.tsx`), so a reader
    // there opens it first, as this does; wider, it is a column already on
    // screen and the button is not drawn.
    if (isMobile) await page.getByRole('button', { name: 'Browse documents' }).click()
    const treeLink = page
      .getByRole('navigation', { name: 'Documents' })
      .getByRole('link', { name: title })
    await expect(treeLink).toBeVisible()
    await expect(treeLink).toHaveAttribute('aria-current', 'page')

    // Back on the workspace home, the document list (a separate view built
    // from the same grouping, `features/workspaces/document-list.tsx`) also
    // shows it.
    await page.goto(`/w/${seed.workspaceId}`)
    await expect(
      page.getByRole('main').getByRole('link', { name: new RegExp(title) }),
    ).toBeVisible()
  })
})
