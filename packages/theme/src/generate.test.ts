import { describe, expect, it } from 'vitest'
import { instrument } from './builtin/instrument.ts'
import { generateTheme } from './generate.ts'
import { TOKEN_NAMES } from './tokens.ts'

describe('generateTheme', () => {
  it('returns both token maps and the report on them', () => {
    const generated = generateTheme(instrument)
    expect(generated.themeId).toBe('instrument')
    expect(Object.keys(generated.light)).toHaveLength(TOKEN_NAMES.length)
    expect(Object.keys(generated.dark)).toHaveLength(TOKEN_NAMES.length)
    expect(generated.report.warnings).toEqual([])
  })

  it('differs between the schemes where colour is involved and agrees where it is not', () => {
    const { light, dark } = generateTheme(instrument)
    expect(dark['--palette-background']).not.toBe(light['--palette-background'])
    expect(dark['--font-reading']).toBe(light['--font-reading'])
    expect(dark['--radius-md']).toBe(light['--radius-md'])
  })

  it('passes the doctor options through', () => {
    const advisory = generateTheme(instrument, { textContrast: 'advisory' })
    expect(advisory.report.results.every((result) => !result.enforced)).toBe(true)
  })

  it('is deterministic', () => {
    expect(generateTheme(instrument)).toEqual(generateTheme(instrument))
  })
})
