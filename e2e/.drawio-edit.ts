// Scratch: edit the scratch document's diagram again; deleted after use.
import { readFileSync } from 'node:fs'

import { chromium } from '@playwright/test'

const OUT = process.argv[2] ?? '.'
const doc = JSON.parse(readFileSync(`${OUT}/scratch.json`, 'utf8')) as { id: string; title: string }
const browser = await chromium.launch()
const context = await browser.newContext({ baseURL: 'http://localhost:5173', viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.addInitScript(() => {
  const w = window as unknown as { __msgs: string[] }
  w.__msgs = []
  window.addEventListener('message', (e) => {
    try {
      const m = JSON.parse(String(e.data)) as { event?: string; xml?: string; data?: string }
      w.__msgs.push(`in:${m.event}${m.xml === undefined ? '' : ':' + m.xml.slice(0, 60)}${m.data === undefined ? '' : ' data fo=' + String(m.data.includes('foreignObject'))}`)
    } catch {
      /* not JSON */
    }
  })
})
const shot = async (name: string) => page.screenshot({ path: `${OUT}/${name}.png` })
await page.goto('/sign-in')
await page.getByLabel('Email', { exact: false }).fill('admin@example.com')
await page.getByLabel('Password', { exact: false }).fill('admin-password-change-me')
for (let attempt = 0; attempt < 20 && page.url().includes('sign-in'); attempt += 1) {
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForTimeout(3000)
}
await page.goto(`/w/engineering/d/${doc.id}/edit`)
await page.getByRole('textbox', { name: doc.title }).waitFor({ timeout: 60_000 })
await page.getByRole('button', { name: 'Edit diagram' }).first().click({ force: true })
const overlay = page.getByRole('dialog', { name: 'Draw.io diagram' })
const frame = page.frameLocator('iframe[title="Draw.io diagram"]')
try {
  await frame.locator('.geDiagramContainer').waitFor({ timeout: 60_000 })
} catch (error) {
  await shot('19-open-stuck')
  console.log((await page.evaluate(() => (window as unknown as { __msgs: string[] }).__msgs)).join(' | '))
  throw error
}
await page.waitForTimeout(1500)
const box = await page.locator('iframe[title="Draw.io diagram"]').boundingBox()
if (box === null) throw new Error('no frame')
const blank = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.85 }
await frame.locator('.geSidebarContainer a.geItem').nth(Number(process.argv[3] ?? 8)).click()
const canvas = await frame.locator('.geDiagramContainer').boundingBox()
if (canvas === null) throw new Error('no canvas')
await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
for (let step = 0; step < 6; step += 1) await page.keyboard.press('Shift+ArrowDown')
await page.waitForTimeout(300)
await page.keyboard.press('F2')
await page.waitForTimeout(300)
await page.keyboard.press('Control+A')
await page.keyboard.type(process.argv[4] ?? 'Queue')
await page.mouse.click(blank.x, blank.y)
await page.waitForTimeout(500)
await shot('20-edit-drawn')
await frame.getByText('Save & Exit', { exact: true }).click()
try {
  await overlay.waitFor({ state: 'detached', timeout: 30_000 })
} catch {
  await shot('21-edit-stuck')
}
await page.waitForTimeout(1500)
await shot('22-edit-saved')
console.log((await page.evaluate(() => (window as unknown as { __msgs: string[] }).__msgs)).join('\n'))
const src = await page.locator('.document-editor-content img').first().getAttribute('src')
console.log('img', src)
await browser.close()
