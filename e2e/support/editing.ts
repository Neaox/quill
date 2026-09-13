import { expect, type Locator } from '@playwright/test'

/**
 * Puts the caret at the end of one block of an editing surface, and does not
 * come back until it is there.
 *
 * More than a click and an `End`, because each of those is a separate event an
 * engine may act on at its own moment, and what the caret's position turns
 * into is a whole document: `Enter` at the end of a heading starts a
 * paragraph, and `Enter` at the top of one splits the heading in two and puts
 * everything typed next inside it. Three things this does that the obvious
 * version does not:
 *
 * - waits for the surface to hold the focus, because a key pressed before
 *   ProseMirror has it is delivered nowhere at all and the caret is then still
 *   wherever the document opened;
 * - asks the block rather than the canvas, because a click in the middle of
 *   the canvas lands wherever the content happens to reach;
 * - checks where the caret actually is afterwards, and presses `End` again
 *   until it is at the end of the block — pressing it twice costs nothing, and
 *   a first press that landed on a block handle or arrived while the surface
 *   was still settling costs a different document in every assertion after it.
 *
 * `Control+End` is deliberately not used anywhere: "the end of the document"
 * in a `contenteditable` is each engine's own opinion, and the four disagree.
 */
export async function caretAtEndOf(surface: Locator, block: Locator): Promise<void> {
  const page = surface.page()
  await expect(block).toBeVisible()
  const text = (await block.textContent()) ?? ''

  await block.click()
  await expect(surface).toBeFocused()

  await expect
    .poll(async () => {
      await page.keyboard.press('End')
      return page.evaluate(() => {
        const selection = globalThis.getSelection()
        const node = selection?.anchorNode ?? null
        if (selection === null || node === null || !selection.isCollapsed) return null
        const content = node.textContent ?? ''
        return selection.anchorOffset === content.length ? content : null
      })
    })
    .toBe(text)
}
