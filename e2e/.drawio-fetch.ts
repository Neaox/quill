import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const context = await browser.newContext({ baseURL: 'http://localhost:5173' })
const page = await context.newPage()
await page.goto('/sign-in')
await page.getByLabel('Email', { exact: false }).fill('admin@example.com')
await page.getByLabel('Password', { exact: false }).fill('admin-password-change-me')
for (let attempt = 0; attempt < 15 && page.url().includes('sign-in'); attempt += 1) {
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForTimeout(3000)
}
const response = await context.request.get(process.argv[2] ?? '')
const text = await response.text()
console.log(response.status(), response.headers()['content-type'], text.length)
console.log('foreignObject', text.includes('foreignObject'), 'convertToSvg?', text.includes('convertToSvg'))
if (process.argv[3]) (await import('node:fs')).writeFileSync(process.argv[3], text)
console.log(text.replace(/content="[^"]*"/, 'content="…"').slice(0, 1500))
await browser.close()
