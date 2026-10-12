import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { CURATED_FACE_LIST } from '@quill/theme'

/*
 * Resolved through a parameter rather than a literal: Vite rewrites a literal
 * `new URL('./x', import.meta.url)` into a served asset address.
 */
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

const fontsCss = readFileSync(here('./fonts.css'), 'utf8')

/** Every `@font-face` block, as the family it declares and the file it points at. */
const faces = [...fontsCss.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body = '']) => ({
  family: /font-family:\s*'([^']+)'/.exec(body)?.[1],
  src: /url\('([^']+)'\)/.exec(body)?.[1],
}))

describe('the self-hosted type set', () => {
  /*
   * A curated face a theme can choose but this file never registers renders
   * in the fallback stack, silently: the theme says Figtree and the reader
   * gets Segoe UI. So the two lists are held together here.
   */
  it.each(CURATED_FACE_LIST.map((face) => face.family))(
    'registers %s in latin and latin-ext',
    (family) => {
      const sources = faces.filter((face) => face.family === family).map((face) => face.src)
      expect(sources.some((src) => src?.includes('-latin-') === true)).toBe(true)
      expect(sources.some((src) => src?.includes('-latin-ext-') === true)).toBe(true)
    },
  )

  it('points every face at a woff2 file that is installed', () => {
    for (const { src } of faces) {
      expect(src).toMatch(/\.woff2$/)
      expect(existsSync(here(src ?? ''))).toBe(true)
    }
  })
})
