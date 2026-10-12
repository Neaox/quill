import type { Locator, Page } from '@playwright/test'

/**
 * The person menu's button in the signed-in bar (`docs/design/chrome.md`,
 * "Reaching settings"). It is rendered by every signed-in page and by nothing
 * a signed-out visitor sees, so waiting for it is how a journey waits for the
 * router to have finished signing somebody in — and its absence is how a
 * public page proves nothing of the signed-in world leaked onto it. Given a
 * name, it is that person's menu, which is how a journey asserts who is
 * signed in.
 */
export function accountMenu(page: Page, displayName?: string): Locator {
  return page.getByRole('button', {
    name: displayName === undefined ? /^Account menu for / : `Account menu for ${displayName}`,
  })
}

/** Signs out the way a person does: open the person menu, choose Sign out. */
export async function signOut(page: Page): Promise<void> {
  await accountMenu(page).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
}
