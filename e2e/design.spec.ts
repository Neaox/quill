import { expect, test, type Page } from '@playwright/test'

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'The design system' })

async function headingBox(page: Page) {
  const box = await heading(page).boundingBox()
  expect(box).not.toBeNull()
  return box
}

/**
 * Browser-specific behaviour this spec accounts for:
 *
 * - **WebKit does not put links in the Tab sequence** (Safari's "Press Tab to
 *   highlight each item on a webpage" is off by default), which is why the
 *   shell's skip link carries an explicit `tabindex` and why the landmark
 *   check below is a real cross-browser assertion rather than a Chromium one.
 */

const rootProperty = (page: Page, name: string) =>
  page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  )

const overflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

test.describe('the design system page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/design')
    await expect(heading(page)).toBeVisible()
    // Every measurement below is of a settled page. The self-hosted faces
    // arrive after `load`, and a swap from the fallback face moves lines.
    await page.evaluate(() => document.fonts.ready)
  })

  test('the scheme toggle sets data-theme and moves nothing', async ({ page }) => {
    const root = page.locator('html')
    const before = await headingBox(page)

    await expect(root).not.toHaveAttribute('data-theme', /.*/)

    await page.getByRole('radio', { name: 'Dark' }).check()
    await expect(root).toHaveAttribute('data-theme', 'dark')

    await page.getByRole('radio', { name: 'Light' }).check()
    await expect(root).toHaveAttribute('data-theme', 'light')

    // Switching scheme repaints colour and moves nothing.
    expect(await headingBox(page)).toEqual(before)

    await page.getByRole('radio', { name: 'System' }).check()
    await expect(root).not.toHaveAttribute('data-theme', /.*/)
  })

  test('the chosen scheme survives a reload without a flash of the other one', async ({ page }) => {
    await page.getByRole('radio', { name: 'Dark' }).check()
    await page.reload()

    // Set by the inline script before first paint, not by React after hydration.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
  })

  test('the identity switcher changes the type and the accent', async ({ page }) => {
    const root = page.locator('html')
    const identity = page.getByRole('group', { name: 'Identity' })

    await expect(root).not.toHaveAttribute('data-theme-id', /.*/)
    const instrument = {
      sans: await rootProperty(page, '--font-sans'),
      accent: await rootProperty(page, '--palette-accent'),
      reading: await rootProperty(page, '--font-reading'),
    }
    expect(instrument.sans).toContain('IBM Plex Sans')

    await identity.getByRole('radio', { name: 'Press' }).check()
    await expect(root).toHaveAttribute('data-theme-id', 'press')

    const press = {
      sans: await rootProperty(page, '--font-sans'),
      accent: await rootProperty(page, '--palette-accent'),
      reading: await rootProperty(page, '--font-reading'),
    }
    expect(press.sans).toContain('Instrument Sans')
    expect(press.reading).toContain('Newsreader')
    expect(press.accent).not.toBe(instrument.accent)

    // An identity is a different type pairing, so the page re-sets rather than
    // staying pixel-identical — but it must not start scrolling sideways.
    expect(await overflows(page)).toBe(false)

    // The default identity is the absence of the attribute, not its name.
    await identity.getByRole('radio', { name: 'Instrument' }).check()
    await expect(root).not.toHaveAttribute('data-theme-id', /.*/)
    expect(await rootProperty(page, '--font-sans')).toBe(instrument.sans)
  })

  test('the identity carries its signature variants with it', async ({ page }) => {
    const tree = page.getByRole('navigation', { name: 'Showcase documents' })
    const shell = page.locator('.document-shell')

    await expect(tree).toHaveAttribute('data-navigation', 'tree')
    await expect(shell).toHaveAttribute('data-rules', 'hairline')
    await expect(page.getByRole('region', { name: 'Revisions' }).first()).toBeVisible()

    await page
      .getByRole('group', { name: 'Identity' })
      .getByRole('radio', { name: 'Atelier' })
      .check()

    await expect(tree).toHaveAttribute('data-navigation', 'tabs')
    await expect(shell).toHaveAttribute('data-rules', 'cards')
  })

  test('the shell is a run of landmarks a keyboard can skip through', async ({ page }) => {
    // WebKit leaves links out of the Tab sequence unless macOS full keyboard
    // access is on, so the skip link carries an explicit `tabindex`
    // (`document-shell.tsx`) and this is the check that keeps it there.
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to document' })
    await expect(skip).toBeFocused()

    await expect(page.getByRole('banner').first()).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible()
    await expect(page.getByRole('main')).toHaveAttribute('id', 'document')
    await expect(page.getByRole('complementary')).toBeVisible()
  })

  test('the code sample is coloured by the token classes the theme defines', async ({ page }) => {
    const keyword = page.locator('.tok-keyword').first()
    await expect(keyword).toBeVisible()

    const colour = await keyword.evaluate((node) => getComputedStyle(node).color)
    const body = await page.locator('body').evaluate((node) => getComputedStyle(node).color)
    expect(colour).not.toBe(body)
  })

  test('the dialog traps focus and returns it to the trigger', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Discard draft' })
    await trigger.click()

    const dialog = page.getByRole('dialog', { name: 'Discard this draft?' })
    await expect(dialog).toBeVisible()

    // Tab all the way round: focus never leaves the dialog. Sequential by
    // necessity, not oversight — each press acts on wherever focus landed
    // after the previous one, so the iterations cannot run independently.
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab')
      await expect(dialog.locator(':focus')).toHaveCount(1)
    }

    await page.keyboard.press('Shift+Tab')
    await expect(dialog.locator(':focus')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('the three layout widths collapse on their container, not on the window', async ({
    page,
  }) => {
    const widths = async (id: string) => {
      const grid = page.locator(`[data-grid-case="${id}"] .layout-grid`)
      const box = async (selector: string) => {
        const found = await grid.locator(selector).first().boundingBox()
        expect(found).not.toBeNull()
        return Math.round(found?.width ?? 0)
      }
      return {
        content: await box('> .layout-content'),
        wide: await box('> .layout-wide'),
        full: await box('> .layout-full'),
      }
    }

    // A container with room for all three keeps them distinct...
    const roomy = await widths('wide')
    expect(roomy.content).toBeLessThan(roomy.wide)
    expect(roomy.wide).toBeLessThan(roomy.full)

    // ...the room this page actually has merges wide into full...
    const pageWidths = await widths('page')
    expect(pageWidths.content).toBeLessThan(pageWidths.wide)
    expect(pageWidths.wide).toBe(pageWidths.full)

    // ...and a preview pane collapses all three, on a 1440px window.
    const pane = await widths('pane')
    expect(pane.content).toBe(pane.wide)
    expect(pane.wide).toBe(pane.full)

    // Nothing is clipped: the page never scrolls sideways.
    expect(await overflows(page)).toBe(false)
  })

  test('a document collapses to one column on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const grid = page.locator('[data-grid-case="page"] .layout-grid')
    const box = async (selector: string) => {
      const found = await grid.locator(selector).first().boundingBox()
      expect(found).not.toBeNull()
      return Math.round(found?.width ?? 0)
    }

    expect(await box('> .layout-content')).toBe(await box('> .layout-wide'))
    expect(await box('> .layout-wide')).toBe(await box('> .layout-full'))
    expect(await overflows(page)).toBe(false)
  })

  test('the shell becomes one column on a phone, in the same order', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const region = async (selector: string) => {
      const box = await page.locator(selector).first().boundingBox()
      expect(box).not.toBeNull()
      return { top: box?.y ?? 0, bottom: (box?.y ?? 0) + (box?.height ?? 0) }
    }

    const header = await region('.shell-header')
    const rail = await region('.shell-rail')
    const nav = await region('.shell-nav')
    const main = await region('.shell-main')

    expect(header.top).toBeLessThan(rail.top)
    expect(rail.top).toBeLessThan(nav.top)
    expect(nav.top).toBeLessThan(main.top)
    // Stacked, with nothing between them: each column sits where the one
    // above it ends, rather than being pushed down by the offset it hangs at
    // when it is sticky beside the header instead of under it.
    expect(rail.top).toBeCloseTo(header.bottom, 0)
    expect(nav.top).toBeCloseTo(rail.bottom, 0)
    expect(await overflows(page)).toBe(false)
  })

  /*
   * Regression (the 2026-09-13 web review's polish pass): on a phone the
   * navigation column is capped at thirteen rems and scrolls its own tree —
   * but as a `static` grid item its scrollable overflow propagated to the
   * viewport, so a workspace with a few hundred documents gave the page
   * thousands of pixels of empty scroll below the document it was showing.
   * The filler stands in for that tree, so this holds without depending on
   * how much the instance happens to contain.
   */
  test('a long tree scrolls inside its own column rather than lengthening the page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const before = await page.evaluate(() => document.documentElement.scrollHeight)

    await page.locator('.shell-nav').evaluate((column) => {
      const filler = document.createElement('div')
      filler.style.height = '4000px'
      column.append(filler)
    })

    const after = await page.evaluate(() => document.documentElement.scrollHeight)
    expect(after).toBe(before)
  })
})
