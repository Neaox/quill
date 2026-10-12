import { describe, expect, it } from 'vitest'
import { grid } from '../builtin/grid.ts'
import { instrument } from '../builtin/instrument.ts'
import type { ThemeDocument } from '../schema/theme-document.ts'
import { validateThemeDocument } from '../schema/validate.ts'
import { buildPalettes } from '../colour/palette.ts'
import { shortfall } from './evidence.ts'
import { brandDistance } from './feel.ts'
import { runThemeDoctor } from './run.ts'
import { applyThemeChange, suggestFixes, type Suggestion } from './suggest.ts'

/** A tenant who drags the ink almost onto the paper. */
const unreadable: ThemeDocument = {
  ...instrument,
  overrides: { light: { '--palette-foreground': 'oklch(95% 0.006 250)' } },
}

const withSteps = (steps: NonNullable<ThemeDocument['seeds']['tone']['steps']>): ThemeDocument => ({
  ...instrument,
  seeds: { ...instrument.seeds, tone: { ...instrument.seeds.tone, steps } },
})

const clashing: ThemeDocument = {
  ...instrument,
  seeds: { tone: { hue: 150, chroma: 0.012 }, accent: { hue: 45, chroma: 0.15, lightness: 50 } },
}

/** What "verified" promises: the fix clears the rule and breaks nothing that held. */
const expectVerified = (theme: ThemeDocument, ruleId: string, suggestion: Suggestion) => {
  const baseline = runThemeDoctor(theme)
  const before = new Set(baseline.warnings.map((warning) => warning.id))
  const after = runThemeDoctor(suggestion.document)

  expect(validateThemeDocument(suggestion.document).valid).toBe(true)
  expect(suggestion.document).toEqual(applyThemeChange(theme, suggestion.change))
  expect(suggestion.result.status).not.toBe('warn')
  expect(after.results.find((result) => result.id === ruleId)?.status).not.toBe('warn')
  expect(after.warnings.every((warning) => before.has(warning.id) && warning.id !== ruleId)).toBe(
    true,
  )
  for (const warning of after.warnings) {
    const earlier = baseline.results.find((result) => result.id === warning.id)
    expect(shortfall(warning.evidence)).toBeLessThanOrEqual(
      shortfall(earlier?.evidence ?? []) + 1e-9,
    )
  }
}

describe('suggestFixes', () => {
  it('lifts the dark raised surface until it reads as raised', () => {
    const [lift, ...rest] = suggestFixes(grid, 'bands/surface-separation')

    expect(lift?.change).toEqual({
      kind: 'neutral-step',
      scheme: 'dark',
      role: 'raised',
      from: 23,
      to: 24.5,
    })
    expect(rest).toEqual([])
    if (lift !== undefined) expectVerified(grid, 'bands/surface-separation', lift)
  })

  it('quietens a dark teal wash only as far as the budget asks, and never to the generated grey', () => {
    const suggestions = suggestFixes(grid, 'chroma/area-budget')

    expect(suggestions.map((suggestion) => suggestion.change)).toEqual([
      {
        kind: 'override-colour',
        token: '--palette-accent-subtle',
        role: 'accentSubtle',
        scopes: ['dark'],
        property: 'chroma',
        from: 0.05,
        to: 0.045,
      },
    ])
    for (const suggestion of suggestions) expectVerified(grid, 'chroma/area-budget', suggestion)
  })

  it('offers nothing when the only fixes would grey out the brand or turn its hue', () => {
    // A green brand accent, stronger in dark than in light: clearing it means
    // cutting the dark accent to the light one's C 0.05, which reads as grey,
    // or dropping the overrides for the seed's orange.
    const green: ThemeDocument = {
      ...instrument,
      overrides: {
        light: { '--palette-accent': 'oklch(50% 0.05 150)' },
        dark: { '--palette-accent': 'oklch(72% 0.12 150)' },
      },
    }
    const greyed = applyThemeChange(green, {
      kind: 'override-colour',
      token: '--palette-accent',
      role: 'accent',
      scopes: ['light', 'dark'],
      property: 'chroma',
      from: 0.12,
      to: 0.05,
    })

    expect(runThemeDoctor(greyed).warnings.map((warning) => warning.id)).not.toContain(
      'dark/rederivation',
    )
    expect(suggestFixes(green, 'dark/rederivation')).toEqual([])
  })

  it('keeps a brand hue that clashes with the greys, and moves the greys instead', () => {
    const suggestions = suggestFixes(clashing, 'hue/neutral-accent-agreement')
    const before = buildPalettes(clashing)

    expect(suggestions.length).toBeGreaterThan(0)
    for (const suggestion of suggestions) {
      expect(['tone-hue', 'tone-chroma']).toContain(suggestion.change.kind)
      expect(buildPalettes(suggestion.document).light.colours.accent).toEqual(
        before.light.colours.accent,
      )
    }
  })

  it('nudges the brand and lets the page do the rest when the brand alone would move too far', () => {
    // Pale greys at the bottom of their bands, and a teal link a shade too
    // light to read on them.
    const pale: ThemeDocument = {
      ...withSteps({ light: { paper: 96, surface: 93, raised: 97 } }),
      overrides: { light: { '--palette-accent': 'oklch(52.5% 0.1 190)' } },
    }
    const suggestions = suggestFixes(pale, 'legibility/text-contrast')
    const grounded = suggestions.find((suggestion) => suggestion.change.kind === 'combined')

    expect(grounded?.change).toMatchObject({
      kind: 'combined',
      changes: [
        { kind: 'override-colour', property: 'lightness', scopes: ['light'] },
        { kind: 'ground-shift', scheme: 'light' },
      ],
    })
    for (const suggestion of suggestions)
      expectVerified(pale, 'legibility/text-contrast', suggestion)
  })

  it('moves only the dark greys for a problem that is only dark', () => {
    const light = buildPalettes(grid).light.colours
    for (const suggestion of suggestFixes(grid, 'chroma/area-budget')) {
      const after = buildPalettes(suggestion.document).light.colours
      expect([after.paper, after.surface, after.raised]).toEqual([
        light.paper,
        light.surface,
        light.raised,
      ])
    }
  })

  it('offers the fixes closest to what the tenant had first', () => {
    const suggestions = suggestFixes(clashing, 'hue/neutral-accent-agreement')
    const before = buildPalettes(clashing)
    const distances = suggestions.map((suggestion) =>
      brandDistance(before, buildPalettes(suggestion.document)),
    )
    expect(distances).toEqual(distances.toSorted((a, b) => a - b))
  })

  it('darkens an overridden ink until text reads again', () => {
    const suggestions = suggestFixes(unreadable, 'legibility/text-contrast')
    const darker = suggestions.find((suggestion) => suggestion.change.kind === 'override-colour')

    expect(suggestions.map((suggestion) => suggestion.change.kind)).toContain('remove-override')
    expect(darker?.change).toMatchObject({ property: 'lightness', from: 95, scopes: ['light'] })
    for (const suggestion of suggestions) {
      expectVerified(unreadable, 'legibility/text-contrast', suggestion)
    }
  })

  it('turns a clashing tone to an agreeing hue, or quietens it', () => {
    const suggestions = suggestFixes(clashing, 'hue/neutral-accent-agreement')

    expect(suggestions.map((suggestion) => suggestion.change)).toEqual(
      expect.arrayContaining([
        { kind: 'tone-hue', from: 150, to: 105 },
        { kind: 'tone-chroma', from: 0.012, to: 0.006 },
      ]),
    )
    for (const suggestion of suggestions) {
      expectVerified(clashing, 'hue/neutral-accent-agreement', suggestion)
    }
  })

  it('keeps a dark wash its colour rather than handing it back to a grey generated one', () => {
    const vivid: ThemeDocument = {
      ...instrument,
      seeds: { ...instrument.seeds, tone: { ...instrument.seeds.tone, chroma: 0 } },
      overrides: { dark: { '--palette-accent-subtle': 'oklch(24% 0.05 250)' } },
    }
    const suggestions = suggestFixes(vivid, 'chroma/area-budget')

    expect(suggestions.map((suggestion) => suggestion.change)).toEqual([
      expect.objectContaining({ kind: 'override-colour', property: 'chroma', to: 0.045 }),
    ])
    for (const suggestion of suggestions) expectVerified(vivid, 'chroma/area-budget', suggestion)
  })

  it('drops a status override that costs the set its separation', () => {
    const muddy: ThemeDocument = {
      ...instrument,
      seeds: {
        ...instrument.seeds,
        statusOverrides: { success: { hue: 150, chroma: 0.02 }, danger: { hue: 27, chroma: 0.02 } },
      },
    }
    const report = runThemeDoctor(muddy)
    const warned = report.warnings.map((warning) => warning.id)

    expect(warned).toContain('hue/status-matched')
    const suggestions = suggestFixes(muddy, 'hue/status-matched')
    expect(suggestions.map((suggestion) => suggestion.change)).toContainEqual({
      kind: 'remove-status-overrides',
      statuses: ['success', 'danger'],
    })
    for (const suggestion of suggestions) expectVerified(muddy, 'hue/status-matched', suggestion)
  })

  it('stops at the limit, and settles for nothing once the search budget is spent', () => {
    expect(suggestFixes(grid, 'chroma/area-budget', {}, { limit: 1 })).toHaveLength(1)
    expect(suggestFixes(grid, 'bands/surface-separation', {}, { budget: 0 })).toEqual([])
  })

  it('refuses a fix that would start another rule warning', () => {
    const faint = withSteps({ dark: { muted: 60 } })
    const suggestions = suggestFixes(faint, 'legibility/text-contrast')

    // Darkening the dark surface under the muted text would clear the
    // contrast and collapse the surface onto the paper, so it is not offered.
    expect(suggestions.map((suggestion) => suggestion.change)).toEqual([
      { kind: 'neutral-step', scheme: 'dark', role: 'muted', from: 60, to: 68 },
    ])
    for (const suggestion of suggestions) {
      expectVerified(faint, 'legibility/text-contrast', suggestion)
    }
  })

  it('withholds a fix that leaves another warning further from its target', () => {
    const pale = withSteps({ light: { paper: 93 } })
    const before = runThemeDoctor(pale).warnings.map((warning) => warning.id)
    expect(before).toContain('bands/role-lightness')

    // Lowering the light panel would part it from the page, and push it out
    // of its own lightness band, which was already warning about the page.
    expect(suggestFixes(pale, 'bands/surface-separation')).toEqual([])
  })

  it('offers removal alone for an override that cannot be read as a colour', () => {
    const opaque: ThemeDocument = {
      ...withSteps({ dark: { surface: 21.5, raised: 23 } }),
      overrides: { dark: { '--palette-surface-raised': 'var(--brand-raised)' } },
    }
    const suggestions = suggestFixes(opaque, 'bands/surface-separation')

    expect(suggestions.map((suggestion) => suggestion.change.kind)).toEqual(['neutral-step'])
  })

  it('looks past roles no token can override, and finds a syntax token that can', () => {
    const dim = withSteps({ light: { paper: 10 } })
    for (const suggestion of suggestFixes(dim, 'legibility/ui-boundaries')) {
      expectVerified(dim, 'legibility/ui-boundaries', suggestion)
    }
    const keyword: ThemeDocument = {
      ...instrument,
      overrides: { light: { '--token-keyword': 'oklch(90% 0.1 250)' } },
    }
    const [removal] = suggestFixes(keyword, 'legibility/text-contrast')
    expect(removal?.change).toEqual({
      kind: 'remove-override',
      token: '--token-keyword',
      role: 'token-keyword',
      scopes: ['light'],
    })
  })

  it('suggests nothing for a rule that holds, a rule it does not know, or one no lever reaches', () => {
    expect(suggestFixes(instrument, 'legibility/text-contrast')).toEqual([])
    expect(suggestFixes(grid, 'no/such-rule')).toEqual([])
    expect(suggestFixes(instrument, 'proportion/accent-coverage', { accentCoverage: 0.5 })).toEqual(
      [],
    )
  })
})

describe('applyThemeChange', () => {
  it('sets each seed lever', () => {
    const { seeds } = instrument
    expect(
      applyThemeChange(instrument, { kind: 'accent-chroma', from: 0, to: 0.1 }).seeds.accent,
    ).toEqual({ ...seeds.accent, chroma: 0.1 })
    expect(
      applyThemeChange(instrument, { kind: 'tone-chroma', from: 0, to: 0.01 }).seeds.tone,
    ).toEqual({ ...seeds.tone, chroma: 0.01 })
    expect(applyThemeChange(instrument, { kind: 'tone-hue', from: 0, to: 90 }).seeds.tone.hue).toBe(
      90,
    )
    expect(
      applyThemeChange(instrument, {
        kind: 'accent-lightness',
        scheme: 'light',
        from: undefined,
        to: 48,
      }).seeds.accent.lightness,
    ).toBe(48)
    expect(
      applyThemeChange(instrument, {
        kind: 'accent-lightness',
        scheme: 'dark',
        from: undefined,
        to: 72,
      }).seeds.accent.darkLightness,
    ).toBe(72)
  })

  it('sets a neutral step without disturbing the others', () => {
    const changed = applyThemeChange(grid, {
      kind: 'neutral-step',
      scheme: 'dark',
      role: 'raised',
      from: 23,
      to: 24.5,
    })
    expect(changed.seeds.tone.steps?.dark).toEqual({ ...grid.seeds.tone.steps?.dark, raised: 24.5 })
    expect(changed.seeds.tone.steps?.light).toEqual(grid.seeds.tone.steps?.light)
    expect(
      applyThemeChange(instrument, {
        kind: 'neutral-step',
        scheme: 'light',
        role: 'paper',
        from: undefined,
        to: 98,
      }).seeds.tone.steps,
    ).toEqual({ light: { paper: 98 } })
  })

  it('removes an override and tidies away scopes it empties', () => {
    const removed = applyThemeChange(grid, {
      kind: 'remove-override',
      token: '--palette-accent-subtle',
      role: 'accentSubtle',
      scopes: ['light', 'dark'],
    })
    expect(removed.overrides).toEqual({ shared: grid.overrides?.shared })

    const none = applyThemeChange(unreadable, {
      kind: 'remove-override',
      token: '--palette-foreground',
      role: 'ink',
      scopes: ['light', 'dark'],
    })
    expect(none).not.toHaveProperty('overrides')
  })

  it('sets an override’s lightness, caps its chroma, and leaves what it cannot read', () => {
    const lighter = applyThemeChange(grid, {
      kind: 'override-colour',
      token: '--palette-accent-subtle',
      role: 'accentSubtle',
      scopes: ['light'],
      property: 'lightness',
      from: 96,
      to: 94,
    })
    expect(lighter.overrides?.light).toEqual({ '--palette-accent-subtle': 'oklch(94% 0.03 190)' })

    const capped = applyThemeChange(grid, {
      kind: 'override-colour',
      token: '--palette-accent-subtle',
      role: 'accentSubtle',
      scopes: ['light', 'dark', 'shared'],
      property: 'chroma',
      from: 0.05,
      to: 0.04,
    })
    expect(capped.overrides?.light).toEqual({ '--palette-accent-subtle': 'oklch(96% 0.03 190)' })
    expect(capped.overrides?.dark).toEqual({ '--palette-accent-subtle': 'oklch(30% 0.04 190)' })
    expect(capped.overrides?.shared).toEqual(grid.overrides?.shared)

    const opaque: ThemeDocument = {
      ...instrument,
      overrides: { light: { '--palette-foreground': 'var(--x)' } },
    }
    expect(
      applyThemeChange(opaque, {
        kind: 'override-colour',
        token: '--palette-foreground',
        role: 'ink',
        scopes: ['light'],
        property: 'lightness',
        from: 0,
        to: 20,
      }),
    ).toEqual(opaque)
  })

  it('moves one scheme’s ground together, inside its bands, and combines changes in order', () => {
    const shifted = applyThemeChange(grid, {
      kind: 'ground-shift',
      scheme: 'dark',
      from: { paper: 19, surface: 21.5, raised: 23 },
      by: 1.5,
    })
    expect(shifted.seeds.tone.steps?.dark).toEqual({
      ...grid.seeds.tone.steps?.dark,
      paper: 20.5,
      surface: 23,
      raised: 24.5,
    })
    expect(shifted.seeds.tone.steps?.light).toEqual(grid.seeds.tone.steps?.light)

    const both = applyThemeChange(instrument, {
      kind: 'combined',
      changes: [
        { kind: 'accent-chroma', from: 0.2, to: 0.15 },
        {
          kind: 'ground-shift',
          scheme: 'light',
          from: { paper: 98, surface: 96, raised: 99 },
          by: -1,
        },
      ],
    })
    expect(both.seeds.accent.chroma).toBe(0.15)
    expect(both.seeds.tone.steps?.light).toEqual({ paper: 97, surface: 95, raised: 98 })
  })

  it('removes a status override, and the overrides object with the last one', () => {
    const one: ThemeDocument = {
      ...instrument,
      seeds: {
        ...instrument.seeds,
        statusOverrides: { success: { hue: 150 }, danger: { hue: 27 } },
      },
    }
    const fewer = applyThemeChange(one, { kind: 'remove-status-overrides', statuses: ['success'] })
    expect(fewer.seeds.statusOverrides).toEqual({ danger: { hue: 27 } })
    const none = applyThemeChange(fewer, { kind: 'remove-status-overrides', statuses: ['danger'] })
    expect(none.seeds).not.toHaveProperty('statusOverrides')
    expect(
      applyThemeChange(instrument, { kind: 'remove-status-overrides', statuses: ['danger'] }).seeds,
    ).toEqual(instrument.seeds)
  })
})
