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
const tree = await (await context.request.get('/api/workspaces/engineering/tree')).text()
const found = [...tree.matchAll(/"id":"([^"]+)"[^{}]*?"title":"(Draw\.io check [^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`)
console.log(found.join('\n') || tree.slice(0, 600))
await browser.close()
