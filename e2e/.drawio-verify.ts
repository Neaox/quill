// Scratch verification for the draw.io extension; deleted after use.
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'

import { chromium, type Page } from '@playwright/test'

import { collectionId, paragraph, heading, publishDocument } from './support/content.ts'

const OUT = process.argv[2] ?? '.'
const STEP = process.argv[3] ?? 'all'
mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'

const browser = await chromium.launch()
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.addInitScript(() => {
  const w = window as unknown as { __msgs: string[] }
  w.__msgs = []
  window.addEventListener('message', (e) => {
    try { const m = JSON.parse(String(e.data)); w.__msgs.push('in:' + m.event + (m.xml ? ':' + String(m.xml).slice(0, 80) : '')) } catch { /* */ }
  })
  const original = HTMLIFrameElement.prototype
  void original
})
const shot = async (name: string, target: Page = page) => {
  await target.screenshot({ path: `${OUT}/${name}.png` })
  console.log('shot', name)
}

await page.goto('/sign-in')
await page.getByLabel('Email', { exact: false }).fill('admin@example.com')
await page.getByLabel('Password', { exact: false }).fill('admin-password-change-me')
for (let attempt = 0; attempt < 15 && page.url().includes('sign-in'); attempt += 1) {
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForTimeout(3000)
}
await shot('00-after-sign-in')
console.log(page.url())

const getJson = async (url: string): Promise<unknown> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await context.request.get(url)
    const text = await response.text()
    if (response.ok() && text !== '') return JSON.parse(text)
    await page.waitForTimeout(1500)
  }
  throw new Error(`could not GET ${url}`)
}
const listed = (await getJson('/api/workspaces')) as Record<string, unknown>
console.log(JSON.stringify(listed).slice(0, 300))
const all = (Array.isArray(listed) ? listed : Object.values(listed).find(Array.isArray)) as { id: string; slug: string }[]
const workspace = all.find((w) => w.slug === 'engineering') ?? all[0]
if (workspace === undefined) throw new Error('no workspace')
const tree = (await getJson(`/api/workspaces/${workspace.id}/tree`)) as {
  collections: { id: string; name: string }[]
}
const collection = tree.collections[0]
if (collection === undefined) throw new Error('no collection')
console.log('workspace', workspace.slug, 'collection', collection.name)

import { existsSync, readFileSync } from 'node:fs'
const SCRATCH = `${OUT}/scratch.json`
let doc: { id: string; title: string }
if (existsSync(SCRATCH)) {
  doc = JSON.parse(readFileSync(SCRATCH, 'utf8'))
} else {
  const created = await context.request.post(`/api/workspaces/${workspace.id}/documents`, {
    headers: { origin: BASE, 'sec-fetch-site': 'same-origin' },
    data: { collectionId: collection.id, title: 'Draw.io scratch (unpublished)' },
  })
  const body = (await created.json()) as { document: { id: string; title: string } }
  doc = { id: body.document.id, title: body.document.title }
  writeFileSync(SCRATCH, JSON.stringify(doc))
}
const title = doc.title
console.log('document', doc.id)
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 300)) })
page.on('response', (r) => { if (r.url().includes('/attachments')) console.log('response', r.request().method(), r.url().slice(-60), r.status()) })
const surface = page.getByRole('textbox', { name: title })
for (let attempt = 0; attempt < 6; attempt += 1) {
  await page.goto(`/w/${workspace.slug}/d/${doc.id}/edit`)
  try {
    await surface.waitFor({ timeout: 20_000 })
    break
  } catch {
    await shot(`00-edit-retry-${attempt}`)
  }
}
await surface.click()
await page.keyboard.press('Control+End')
await page.keyboard.press('Enter')
if (STEP !== 'edit') {
await page.keyboard.type('/drawio')
await page.waitForTimeout(400)
await shot('01-slash')
await page.keyboard.press('Enter')
const describe = page.getByRole('dialog', { name: 'New draw.io diagram' })
await describe.waitFor()
await describe.getByLabel('What the diagram shows').fill('A browser sends a request to the Quill server')
await shot('02-describe')
await describe.getByRole('button', { name: 'Open the editor' }).click()

const overlay = page.getByRole('dialog', { name: 'Draw.io diagram' })
await overlay.waitFor()
const frame = page.frameLocator('iframe[title="Draw.io diagram"]')
await frame.locator('.geDiagramContainer').waitFor({ timeout: 60_000 })
await page.waitForTimeout(1500)
await shot('03-editor-open')

if (STEP === 'open') {
  await browser.close()
  process.exit(0)
}

const box = await page.locator('iframe[title="Draw.io diagram"]').boundingBox()
if (box === null) throw new Error('no frame box')
const blank = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.85 }
const shapes = frame.locator('.geSidebarContainer a.geItem')
const place = async (index: number, label: string, key: string) => {
  await shapes.nth(index).click()
  const canvas = await frame.locator('.geDiagramContainer').boundingBox()
  if (canvas === null) throw new Error('no canvas')
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  for (let step = 0; step < 8; step += 1) await page.keyboard.press(`Shift+${key}`)
  await page.waitForTimeout(300)
  await page.keyboard.press('F2')
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+A')
  await page.keyboard.type(label)
  await page.mouse.click(blank.x, blank.y)
}
await place(1, 'Gateway', 'ArrowLeft')
await place(4, 'Ledger', 'ArrowRight')
await page.waitForTimeout(500)
await shot('04-editor-drawn')
await frame.getByText('Save & Exit', { exact: true }).click()
try {
  await overlay.waitFor({ state: 'detached', timeout: 30_000 })
} catch (error) {
  await shot('05-save-stuck')
  console.log((await page.evaluate(() => (window as unknown as { __msgs: string[] }).__msgs)).join('
'))
  throw error
}
await page.waitForTimeout(1500)
await shot('05-inserted')
const edit = page.getByRole('button', { name: 'Edit diagram' })
console.log('edit buttons', await edit.count())
const img = page.locator('.document-editor-content img').first()
console.log('img', await img.getAttribute('src'), await img.getAttribute('alt'))
await shot('06-edit-button')
writeFileSync(`${OUT}/attachment.txt`, String(await img.getAttribute('src')))
}

// Edit it again.
await page.goto(`/w/${workspace.slug}/d/${doc.id}/edit`)
await surface.waitFor()
await page.getByRole('button', { name: 'Edit diagram' }).click({ force: true })
await overlay.waitFor()
await frame.locator('.geDiagramContainer').waitFor({ timeout: 60_000 })
await page.waitForTimeout(1500)
await shot('12-reopened')
await place(8, 'Queue', 'ArrowDown')
await frame.getByText('Save & Exit', { exact: true }).click()
await overlay.waitFor({ state: 'detached', timeout: 30_000 })
await page.waitForTimeout(1500)
await shot('13-edited-in-editor')
console.log((await page.evaluate(() => (window as unknown as { __msgs: string[] }).__msgs)).join('
'))
await browser.close()
