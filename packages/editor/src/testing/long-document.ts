/**
 * The long document of the editor's keystroke budget (quill-plan.md section
 * 31; P0-6 in docs/research/2026-10-11-editor-vs-confluence.md).
 *
 * It is the probe's shape, so a number measured against it can be compared
 * with the report's: repeated sections, each a heading, a paragraph with marks,
 * a link and a label, a nested list, a table and a TypeScript fence. At the
 * default 240 sections that is about 4,100 Markdown lines, 1,200 top-level
 * blocks and 240 code blocks.
 */

/** The probe's section count. */
export const LONG_DOCUMENT_SECTIONS = 240

function section(index: number): string {
  const n = String(index + 1)
  return [
    `## Section ${n}: rotating the signing keys`,
    '',
    `Every **request** in section ${n} carries a _short-lived_ token, checked by the`,
    `[gateway](https://example.com/gateway/${n}) with \`verify()\` before :status[stable] work starts.`,
    '',
    '- Issue a new key',
    '  - Publish it to the key set',
    '- Retire the old key',
    '',
    '| Step | Owner | Window |',
    '| - | - | - |',
    `| Issue | Platform | ${n} min |`,
    '',
    '```ts',
    `export const rotate${n} = (keys: readonly string[]) => [...keys.slice(1), crypto.randomUUID()]`,
    '```',
    '',
  ].join('\n')
}

/** The long document as Markdown, with `sections` repeated sections. */
export function longDocumentMarkdown(sections: number = LONG_DOCUMENT_SECTIONS): string {
  return [
    '# Key rotation runbook',
    '',
    ...Array.from({ length: sections }, (_, index) => section(index)),
  ].join('\n')
}
