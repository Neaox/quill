import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:8765/')
await page.waitForFunction(() => window.messages.some((m) => m.event === 'load'), null, { timeout: 60000 })
const post = (msg) => page.evaluate((m) => document.getElementById('f').contentWindow.postMessage(JSON.stringify(m), '*'), msg)
const cell = (id, value, style, x) => `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="200" width="120" height="60" as="geometry"/></mxCell>`
const file = (cells) => `<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`
const base = cell('a','Browser','rounded=1;whiteSpace=wrap;html=1;',40) + cell('b','Quill server','rounded=1;whiteSpace=wrap;html=1;',260)
const added = base + cell('c','Queue','ellipse;whiteSpace=wrap;html=1;',480)
const converted = added.replaceAll('html=1;', 'html=1;convertToSvg=1;svgWhiteSpace=wrap;')
const step = process.argv[2]
if (step === 'merge-add') { await post({ action: 'merge', xml: file(added) }); await page.waitForTimeout(1500) }
await post({ action: 'merge', xml: file(converted) })
await page.waitForFunction(() => window.messages.some((m) => m.event === 'merge'), null, { timeout: 20000 })

await post({ action: 'export', format: 'xmlsvg', asText: true, embedFonts: false })
await page.waitForFunction(() => window.lastExport !== undefined, null, { timeout: 20000 })
const exp = await page.evaluate(() => window.messages.filter((m) => m.event === 'merge' || m.event === 'export').map((m) => ({ e: m.event, err: m.error })))
const svg = await page.evaluate(() => window.lastExport.data)
console.log(JSON.stringify(exp))
console.log('foreignObject', svg.includes('foreignObject'), 'Queue', svg.includes('Queue'), 'Browser', svg.includes('>Browser<'))
console.log('XML', await page.evaluate(() => window.lastXml))
await browser.close()
