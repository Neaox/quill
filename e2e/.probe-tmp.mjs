import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
const [config, out, opts, dark] = [process.argv[2] ?? '{}', process.argv[3], process.argv[4] ?? '{}', process.argv[5] === 'dark']
const browser = await chromium.launch()
const page = await browser.newPage({ colorScheme: dark ? 'dark' : 'light' })
await page.addInitScript((c) => { window.__config = JSON.parse(c) }, config)
await page.goto('http://localhost:8765/')
await page.evaluate((s) => { window.config = window.__config; if (s) window.loadXml = window.XML.replaceAll('html=1;', 'html=1;convertToSvg=1;') }, process.argv[6] === 'svgtext')
await page.waitForFunction(() => window.messages.some((m) => m.event === 'load'), null, { timeout: 60000 })
await page.evaluate((o) => window.exportSvg(JSON.parse(o)), opts)
await page.waitForFunction(() => window.lastExport !== undefined, null, { timeout: 60000 })
const res = await page.evaluate(() => ({ msgs: window.messages.map((m) => m.event), exp: window.lastExport }))
writeFileSync(out, res.exp.data ?? '')
console.log(JSON.stringify(res.msgs), Object.keys(res.exp), res.exp.xml?.slice(0, 300))
await browser.close()
