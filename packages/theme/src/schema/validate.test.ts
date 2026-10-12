import { describe, expect, it } from 'vitest'
import { press } from '../builtin/press.ts'
import { toIssues, validateThemeDocument } from './validate.ts'

const withType = (type: Record<string, unknown>): unknown => ({ ...press, type })

describe('toIssues', () => {
  it('reports nothing when ajv recorded nothing', () => {
    expect(toIssues(null)).toEqual([])
    expect(toIssues(undefined)).toEqual([])
  })
})

describe('validateThemeDocument', () => {
  it('accepts a built-in theme', () => {
    const result = validateThemeDocument(press)
    expect(result.valid).toBe(true)
    expect(result.valid && result.document.id).toBe('press')
  })

  it('accepts an uploaded face with its licence recorded', () => {
    const result = validateThemeDocument(
      withType({
        ...press.type,
        display: {
          source: 'uploaded',
          family: 'Northwind Display',
          url: '/fonts/northwind.woff2',
          generic: 'serif',
          licence: { name: 'OFL-1.1', holder: 'Northwind' },
        },
      }),
    )
    expect(result.valid).toBe(true)
  })

  it('reports every schema problem at once, with a path', () => {
    const result = validateThemeDocument({
      ...press,
      id: 'Not A Slug',
      shape: { radiusStep: 9, density: 'roomy' },
    })
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['/id', '/shape/radiusStep', '/shape/density']),
    )
  })

  it('accepts a reading setting inside its bounds and refuses one outside them', () => {
    expect(
      validateThemeDocument(
        withType({ ...press.type, scale: { size: 18.5, leading: 1.68, measure: 40 } }),
      ).valid,
    ).toBe(true)

    const result = validateThemeDocument(
      withType({ ...press.type, scale: { size: 24, leading: 1.2, measure: 60, tracking: 0 } }),
    )
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['/type/scale/size', '/type/scale/leading', '/type/scale/measure']),
    )
  })

  it('accepts every built-in id as a base, including a superseded one', () => {
    for (const base of ['instrument', 'calm', 'editorial', 'grid', 'atelier', 'press']) {
      expect(validateThemeDocument({ ...press, id: 'northwind', base }).valid).toBe(true)
    }
    expect(validateThemeDocument({ ...press, id: 'northwind', base: 'bauhaus' }).valid).toBe(false)
  })

  it('names the document itself for a problem that has no path', () => {
    const result = validateThemeDocument({ ...press, unexpected: true })
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.issues[0]?.path).toBe('')
    expect(result.issues[0]?.message).toContain('the theme document')
  })

  it('accepts lightness steps for the tone and a dark accent start, and refuses a stray step', () => {
    const stepped = {
      ...press,
      seeds: {
        ...press.seeds,
        tone: { ...press.seeds.tone, steps: { light: { paper: 97, body: 38 }, dark: { ink: 95 } } },
        accent: { ...press.seeds.accent, darkLightness: 72 },
      },
    }
    expect(validateThemeDocument(stepped).valid).toBe(true)
    expect(
      validateThemeDocument({
        ...stepped,
        seeds: {
          ...stepped.seeds,
          tone: { ...stepped.seeds.tone, steps: { light: { glow: 50 } } },
        },
      }).valid,
    ).toBe(false)
  })

  it('rejects a value that is not an object at all', () => {
    expect(validateThemeDocument('press').valid).toBe(false)
  })

  it('rejects a curated face used for a role it is not offered for', () => {
    const result = validateThemeDocument(
      withType({ ...press.type, mono: { source: 'curated', id: 'newsreader' } }),
    )
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.issues).toEqual([
      { path: '/type/mono', message: expect.stringContaining('mono role'), rule: 'face-role' },
    ])
  })

  it('rejects an uploaded mono face that falls back to a proportional generic', () => {
    const result = validateThemeDocument(
      withType({
        ...press.type,
        mono: {
          source: 'uploaded',
          family: 'Northwind Mono',
          url: '/fonts/northwind-mono.woff2',
          generic: 'serif',
          licence: { name: 'OFL-1.1' },
        },
      }),
    )
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.issues[0]?.rule).toBe('face-generic')
  })
})
