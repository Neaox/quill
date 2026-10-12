// Scratch: show a rendered draw.io body inside the reader preview's real page, without publishing anything.
import { readFileSync } from 'node:fs'

import { chromium } from '@playwright/test'

const SH = process.argv[2] ?? '.'
const body = readFileSync(`${SH}/rendered.html`, 'utf8')
const browser = await chromium.launch()
const context = await browser.newContext({ baseURL: 'http://localhost:5173', viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.goto('/sign-in')
await page.getByLabel('Email', { exact: false }).fill('admin@example.com')
await page.getByLabel('Password', { exact: false }).fill('admin-password-change-me')
for (let attempt = 0; attempt < 20 && page.url().includes('sign-in'); attempt += 1) {
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForTimeout(3000)
}
const tree = await (await context.request.get('/api/workspaces/engineering/tree')).text()
const overview = /"id":"([^"]+)"[^{}]*?"title":"System overview"/.exec(tree)?.[1]
if (overview === undefined) throw new Error('no System overview')
// The page as the server renders it, with this body in place of the document's; nothing is written.
await page.route('**/preview/d/**', async (route) => {
  const response = await route.fetch()
  const html = (await response.text()).replace(/<article[\s\S]*<\/article>/, body)
  await route.fulfill({ response, body: html })
})
const shot = async (name: string) => page.screenshot({ path: `${SH}/shots/${name}.png` })
const open = async () => {
  await page.goto(`/preview/d/${overview}`)
  await page.locator('.diagram svg').first().waitFor()
  await page.waitForTimeout(800)
}
await open()
await shot('30-public-light-1440')
await page.emulateMedia({ colorScheme: 'dark' })
await open()
await shot('31-public-dark-1440')
const expand = page.getByRole('button', { name: /Expand/ }).first()
console.log('expand buttons', await page.getByRole('button', { name: /Expand/ }).count())
await page.locator('.diagram').first().evaluate((e) => e.scrollIntoView({ block: 'center' }))
await expand.click()
await page.waitForTimeout(700)
await shot('32-lightbox-dark')
await page.keyboard.press('Escape')
await page.setViewportSize({ width: 375, height: 812 })
await open()
await page.locator('.diagram').first().scrollIntoViewIfNeeded()
await shot('33-public-dark-375')
await page.emulateMedia({ colorScheme: 'light' })
await open()
await page.locator('.diagram').nth(1).scrollIntoViewIfNeeded()
await shot('34-public-light-375-legacy')
console.log('legacy img', await page.locator('img[data-drawio-legacy]').count())
await browser.close()
