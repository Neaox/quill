import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The writing surface's containment (quill-plan.md section 31).
 *
 * A keystroke in a 1,200-block document lays out, paints and composites
 * every block unless the blocks off screen are skipped; measured in Chrome,
 * that is the difference between a 60 ms keystroke and one inside a frame.
 * The rule is CSS, so what can be guarded without a browser is that it is
 * there and keeps the three properties that make it safe.
 */

// Through a variable: Vite rewrites `new URL('<literal>', import.meta.url)`
// into a served asset address, which is not a file (`fonts.test.ts`).
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
const editorCss = readFileSync(here('editor.css'), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): ReadonlyMap<string, string> {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
  const body = new RegExp(String.raw`(?:^|\})\s*${escaped}\s*\{([^}]*)\}`, 'u').exec(
    css.replaceAll(/\/\*[\s\S]*?\*\//gu, ''),
  )?.[1]
  const declared = new Map<string, string>()
  for (const [, name, value] of (body ?? '').matchAll(/([a-z-]+)\s*:\s*([^;]+);/gu)) {
    /* v8 ignore next -- both capture groups are mandatory in the pattern. */
    if (name === undefined || value === undefined) continue
    declared.set(name, value.trim())
  }
  return declared
}

describe('the top-level blocks of the writing surface', () => {
  const blocks = rule(editorCss, '.document-editor-content > *')

  it('are skipped while off screen', () => {
    expect(blocks.get('content-visibility')).toBe('auto')
  })

  it('keep the size they were last drawn at, so the scrollbar does not jump', () => {
    expect(blocks.get('contain-intrinsic-block-size')).toMatch(/^auto \S+$/u)
  })

  it('paint the handles that stand outside them, which containment would clip', () => {
    // The table handles reach 3rem beyond the table (`table-editor.css`).
    expect(blocks.get('overflow-clip-margin')).toBe('3rem')
  })
})
