import { randomUUID } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { seedDevelopmentData, ADMIN_EMAIL, ADMIN_PASSWORD } from './support/seed.ts'

/**
 * The settings journey: use cases 35 and 36, answered through the interface
 * and nothing else.
 *
 * Two questions, both of which only a real browser can answer. **Does the
 * theme editor show what a change does before it is saved** — the palettes are
 * generated in the browser from the edited document, so the preview's own
 * custom properties are the evidence, and they must survive the round trip to
 * the server and back. And **does a workspace's layout stay the workspace's**
 * — chosen there, refused when the organisation locks it.
 *
 * ## Why this spec runs on one browser profile
 *
 * The other journeys run on all four because four people reading four
 * documents do not collide. This one writes **the** organisation settings
 * document: there is exactly one per instance, holding the theme, the layout
 * default and the lock. `playwright.config.ts` is `fullyParallel` with a
 * project per engine, and `mode: 'serial'` only orders a file *within* a
 * project — so four profiles would reach `PUT /settings/organisation` at once
 * with the same `expectedRevision`, one would win, and the other three would
 * be answered `409 settings_conflict` by the compare-and-swap that exists
 * precisely to refuse them (`docs/architecture/api-contract-settings.md`).
 *
 * That race is worth testing and *is* tested — in
 * `apps/server/src/routes/settings.integration.test.ts` for the server's
 * behaviour, and in `organisation-settings-page.test.tsx` for the state the
 * screen shows. What it cannot do is tell four browsers apart: "save, reload,
 * see what I saved" has no answer when three of the four were correctly
 * refused. Nothing here is engine-sensitive in a way the component tests
 * cannot see, so the browser matrix buys nothing to set against that.
 *
 * If the settings screens ever gain something genuinely per-engine, the split
 * to make is by scope — a workspace's own settings are one document per
 * workspace and are safe on every profile once each profile makes its own —
 * not to run this file four times.
 *
 * `browserName` rather than the project's name, because it is the one
 * Playwright offers a file-scope `test.skip`, and the three it excludes are
 * exactly `firefox`, `webkit` and `mobile-safari` (which is WebKit). A second
 * Chromium-based project would run this file too, and would need this line
 * changed.
 */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'One organisation settings document per instance; see the comment above.',
)

/**
 * Serial, and given a journey's budget: each test leaves the instance's
 * settings changed, and the next reads them.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 })

/** Wide enough for the editor's two columns and the shell's four. */
test.use({ viewport: { width: 1440, height: 900 } })

const ACCENT = '--palette-accent'

/** Unique per run, so the journey can run twice against one instance. */
const SECRET_NAME = `e2e/settings-journey-${randomUUID().slice(0, 8)}`

async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: false }).fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: false }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Waits for the page the router settled on rather than for the address bar,
  // so a `page.goto` after it is not cancelled by the home route's redirect
  // (the reasoning is spelled out in `organise.spec.ts`).
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(page).not.toHaveURL(/sign-in/)
}

/**
 * Presses Save and waits for the write to have actually landed.
 *
 * `Button` renders `disabled={disabled || loading}` and `aria-busy={loading}`
 * (`packages/ui/src/components/button.tsx`), so "the Save button is disabled"
 * is *also* true for the whole time the request is in flight — asserting only
 * that would pass during the write and march on before the answer arrived,
 * which is how a refusal looks like a success. What says the write finished is
 * the busy attribute clearing; what says the server *took* it is the form
 * agreeing with the server again, which is the sentence every settings screen
 * renders when there is nothing left to save. A conflict or a refusal leaves
 * the draft dirty, so that sentence never appears and this fails.
 */
async function save(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Save' })
  await button.click()
  await expect(button).not.toHaveAttribute('aria-busy', 'true')
  await expect(
    page.getByText('Nothing has changed yet, so there is nothing to save.'),
  ).toBeVisible()
}

/**
 * Moves a slider the way a person without a mouse does: focus it, then a key.
 *
 * Not `fill()`. Playwright's `fill` on an `input[type=range]` assigns `.value`
 * and dispatches the events itself, and React's own value tracker can swallow
 * the `input` event that follows an assignment it already saw — which is why
 * it moved the preview on Chromium and not on Firefox or WebKit. A key press
 * is a real interaction: the browser produces the event, every engine
 * produces the same one, and it is the interaction a keyboard user has.
 */
async function pressOnSlider(slider: Locator, key: string): Promise<void> {
  await slider.focus()
  await slider.press(key)
}

/** The generated accent the light preview pane is painted with. */
async function previewAccent(page: Page): Promise<string> {
  const pane = page.locator('[data-scheme="light"]')
  await expect(pane).toBeVisible()
  return pane.evaluate((element, property) => element.style.getPropertyValue(property), ACCENT)
}

/**
 * The workspace's own overflow, in the sidebar header.
 *
 * Named for the workspace *as a workspace*, which is what tells it apart from
 * the menu every document row in the tree below it carries.
 */
function workspaceOverflow(page: Page, name: string): Locator {
  return page.getByRole('button', { name: `More actions for the ${name} workspace` })
}

test.describe('instance settings', () => {
  test('gives the organisation its identity, and keeps it', async ({ page }) => {
    await signIn(page)

    // The settings area is reached from the organisation admin page, and opens
    // on the organisation rather than a landing page.
    await page.goto('/admin/organisation')
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Organisation' })).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('link', { name: 'Theme' })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: 'Theme' })).toBeVisible()

    const before = await previewAccent(page)
    expect(before).not.toBe('')

    /*
     * The levers are the layer-2 set; the accent is the one everybody moves.
     *
     * The move is **relative to what is there**, never to a fixed number. The
     * settings document persists, so a retry — and CI allows two — starts from
     * whatever the previous attempt left, and a test that set an absolute
     * value would find the slider already at it, see nothing regenerate, and
     * fail again for good. Sending the hue to whichever end it is further from
     * always moves it, however many times this runs.
     */
    const hue = page.getByLabel('Accent hue')
    const started = Number(await hue.inputValue())
    const key = started > 180 ? 'Home' : 'End'
    const expected = key === 'Home' ? '0' : '359'
    await pressOnSlider(hue, key)
    await expect(hue).toHaveValue(expected)
    await expect(page.getByText(`${expected}°`)).toBeVisible()

    // Generated in this browser: the preview changed without a round trip.
    await expect.poll(async () => previewAccent(page)).not.toBe(before)
    const previewed = await previewAccent(page)

    // The doctor reports beside the form, and never refuses the save.
    await expect(page.getByRole('list', { name: 'Theme doctor report' })).toBeVisible()

    await save(page)

    // Reloaded from the settings file, the same theme comes back — and the
    // preview generates the same palette from it.
    await page.reload()
    await expect(page.getByLabel('Accent hue')).toHaveValue(expected)
    expect(await previewAccent(page)).toBe(previewed)

    // Editing a built-in forks it, so the built-in stays as it shipped.
    await expect(page.getByText(/Forked from Instrument/)).toBeVisible()
  })

  test('sets the layout every workspace starts with, and does not lock it', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/settings/layout')

    await expect(page.getByRole('heading', { level: 1, name: 'Layout' })).toBeVisible()
    await page.getByRole('radio', { name: /Collection tabs/ }).check()

    const lock = page.getByRole('checkbox', { name: 'Every workspace uses this arrangement' })
    if (await lock.isChecked()) await lock.uncheck()

    await save(page)

    await page.reload()
    await expect(page.getByRole('radio', { name: /Collection tabs/ })).toBeChecked()
    await expect(
      page.getByRole('checkbox', { name: 'Every workspace uses this arrangement' }),
    ).not.toBeChecked()
  })

  test('lets a workspace choose its own layout, from its own overflow', async ({ page }) => {
    const { workspaceId } = seedDevelopmentData()
    await signIn(page)
    await page.goto(`/w/${workspaceId}`)

    // The entry is in the workspace's overflow, beside the control that adds a
    // collection — not in the instance's settings area, because the layout is
    // the workspace's (ADR-028's amendment).
    await workspaceOverflow(page, 'Engineering').click()
    await page.getByRole('menuitem', { name: 'Workspace settings' }).click()

    await expect(page.getByRole('heading', { level: 1, name: /settings$/ })).toBeVisible()
    // Inheriting is the default, and the organisation's default — set by the
    // test before this one — is what it resolves to today.
    await expect(
      page.getByRole('radio', { name: 'Follow the organisation’s default' }),
    ).toBeChecked()
    await expect(page.getByText(/Navigation: Collection tabs/)).toBeVisible()

    await page.getByRole('radio', { name: 'Choose for this workspace' }).check()
    await page.getByRole('radio', { name: /Sidenotes/ }).check()
    await save(page)

    await page.reload()
    await expect(page.getByRole('radio', { name: 'Choose for this workspace' })).toBeChecked()
    await expect(page.getByRole('radio', { name: /Sidenotes/ })).toBeChecked()

    // Identity is not offered here: it belongs to the organisation, and a
    // workspace inherits it.
    await expect(page.getByLabel('Accent hue')).toHaveCount(0)
  })

  test('refuses a workspace’s layout once the organisation locks it', async ({ page }) => {
    const { workspaceId } = seedDevelopmentData()
    await signIn(page)

    await page.goto('/admin/settings/layout')
    await page.getByRole('checkbox', { name: 'Every workspace uses this arrangement' }).check()
    await save(page)

    await page.goto(`/w/${workspaceId}/settings`)
    // Shown and refused, not hidden: the workspace sees the arrangement it has
    // and who decided it (docs/design/feedback.md).
    await expect(page.getByText('The organisation decides the layout')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Choose for this workspace' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()

    // Put it back, so the instance is left as the other journeys expect it.
    await page.goto('/admin/settings/layout')
    await page.getByRole('checkbox', { name: 'Every workspace uses this arrangement' }).uncheck()
    await save(page)
  })

  test('never shows a secret’s value, and points at the command that rotates the key', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto('/admin/settings/secrets')

    await expect(page.getByRole('heading', { level: 1, name: 'Secrets' })).toBeVisible()
    await page.getByRole('button', { name: 'Add a secret' }).click()

    const dialog = page.getByRole('dialog', { name: 'Add a secret' })
    await dialog.getByLabel('Name').fill(SECRET_NAME)
    await dialog.getByLabel('Value').fill('a-value-nothing-will-show-again')
    await dialog.getByRole('button', { name: 'Store' }).click()

    const row = page.getByRole('row', { name: new RegExp(escapeForRegExp(SECRET_NAME)) })
    await expect(row).toBeVisible()
    // The value is nowhere on the page, because no response carries one.
    await expect(page.getByText('a-value-nothing-will-show-again')).toHaveCount(0)
    await expect(page.getByText('pnpm --filter @quill/server secrets:rotate')).toBeVisible()

    await row.getByRole('button', { name: `Delete ${SECRET_NAME}` }).click()
    // `ConfirmDeleteDialog` titles itself `Delete “<name>”?`, curly quotes and
    // all, so the name is what this asks for rather than the whole sentence.
    const confirm = page.getByRole('dialog', {
      name: new RegExp(escapeForRegExp(SECRET_NAME)),
    })
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(row).toHaveCount(0)
  })

  test('opens on the first section rather than a landing page', async ({ page }) => {
    await signIn(page)

    await page.goto('/admin/settings')
    await expect(page).toHaveURL(/\/admin\/settings\/organisation$/)
    await expect(page.getByRole('navigation', { name: 'Settings' })).toBeVisible()
  })
})

/** A secret's name is path-like, and `/` is fine in a regular expression — the dots are not. */
function escapeForRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}
