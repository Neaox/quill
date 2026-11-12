import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { STYLE_CLASSES } from '@quill/markdown/math'

import { styleSheetPath } from './index.ts'

const PROSE = readFileSync(styleSheetPath('prose.css'), 'utf8')

describe('the reading stylesheet and math', () => {
  it('styles every class the renderer gives a declaration Temml wrote as a style', () => {
    const missing = Object.values(STYLE_CLASSES).filter(
      (className) => !PROSE.includes(`.${className}`),
    )

    expect(missing).toEqual([])
  })

  it('styles the wrappers and the error a formula may be shown in', () => {
    for (const className of ['math', 'math-error', 'math-error-message']) {
      expect(PROSE).toContain(`.${className}`)
    }
  })
})
