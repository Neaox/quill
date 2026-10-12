import { describe, expect, it } from 'vitest'

import { press } from './builtin/press.ts'
import { BUILTIN_THEMES } from './builtin/themes.ts'
import { cssString } from './css-string.ts'
import { fontFaceCss, themeFaces } from './font-face.ts'
import { CURATED_FACE_FILES, SUBSET_UNICODE_RANGES } from './schema/face-files.ts'
import type { ThemeDocument } from './schema/theme-document.ts'

const href = (packageName: string, file: string) => `/fonts/${packageName}/${file}`

const withType = (type: Partial<ThemeDocument['type']>): ThemeDocument => ({
  ...BUILTIN_THEMES.instrument,
  type: { ...BUILTIN_THEMES.instrument.type, ...type },
})

describe('the faces a theme names', () => {
  it('lists each face once, however many roles it plays', () => {
    const theme = withType({
      display: { source: 'curated', id: 'inter' },
      interface: { source: 'curated', id: 'inter' },
    })
    const ids = themeFaces(theme).map((face) => (face.source === 'curated' ? face.id : face.family))
    expect(ids.filter((id) => id === 'inter')).toHaveLength(1)
  })
})

describe('fontFaceCss', () => {
  it('declares every file of every curated face the theme names, and nothing else', () => {
    const css = fontFaceCss(BUILTIN_THEMES.instrument, { curatedHref: href })
    for (const id of ['ibm-plex-sans', 'ibm-plex-serif', 'ibm-plex-mono'] as const) {
      const { package: packageName, files } = CURATED_FACE_FILES[id]
      for (const face of files) {
        expect(css).toContain(`url('/fonts/${packageName}/${face.file}') format('woff2')`)
      }
    }
    expect(css).not.toContain('newsreader')
    expect(css.match(/@font-face/gu)).toHaveLength(13)
  })

  it('carries the family, style, weight, swap and the subset’s range on each rule', () => {
    const css = fontFaceCss(press, { curatedHref: href })
    expect(css).toContain("font-family: 'Newsreader';")
    expect(css).toContain('font-style: italic;')
    expect(css).toContain('font-weight: 200 800;')
    expect(css).toContain('font-display: swap;')
    expect(css).toContain(`unicode-range: ${SUBSET_UNICODE_RANGES['latin-ext']};`)
  })

  it('declares an uploaded face served from this origin, with its generic fallback left to the stack', () => {
    const css = fontFaceCss(
      withType({
        reading: {
          source: 'uploaded',
          family: 'Acme Text',
          url: '/api/attachments/face-1',
          generic: 'serif',
          licence: { name: 'OFL-1.1' },
        },
      }),
      { curatedHref: href },
    )
    expect(css).toContain("font-family: 'Acme Text';")
    expect(css).toContain("src: url('/api/attachments/face-1');")
  })

  it('declares no uploaded face from another origin: the policy would refuse it anyway', () => {
    for (const url of [
      'https://fonts.example/face.woff2',
      '//fonts.example/face.woff2',
      'data:x',
    ]) {
      const css = fontFaceCss(
        withType({
          display: {
            source: 'uploaded',
            family: 'Elsewhere',
            url,
            generic: 'sans-serif',
            licence: { name: 'Proprietary' },
          },
        }),
        { curatedHref: href },
      )
      expect(css).not.toContain('Elsewhere')
    }
  })

  it('cannot be broken out of by a family or an address', () => {
    const css = fontFaceCss(
      withType({
        display: {
          source: 'uploaded',
          family: "x'; } body { display: none } .y { --z: '",
          url: "/api/attachments/a') } body { color: red } .b { src: url('",
          generic: 'sans-serif',
          licence: { name: 'OFL-1.1' },
        },
      }),
      { curatedHref: href },
    )
    // Whatever was typed stays inside a string: take the strings away and
    // nothing of it is left to be read as a rule.
    const outsideStrings = css.replaceAll(/'(?:[^'\\]|\\.)*'/gu, "''")
    expect(outsideStrings).not.toContain('body')
    const rules = outsideStrings.match(/@font-face/gu)?.length ?? 0
    expect(rules).toBeGreaterThan(0)
    expect(outsideStrings.match(/\{/gu)).toHaveLength(rules)
  })
})

describe('cssString', () => {
  it('quotes, and escapes what would end the string or the line', () => {
    expect(cssString('Inter')).toBe("'Inter'")
    expect(cssString("it's")).toBe("'it\\27 s'")
    expect(cssString('back\\slash')).toBe("'back\\5c slash'")
    expect(cssString('line\nbreak')).toBe("'line\\a break'")
  })
})
