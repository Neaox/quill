import { describe, expect, it } from 'vitest'

import type { ThemeChange } from '@quill/theme'

import { describeChange, describeChangeDetail, describeVerdict } from './doctor-copy.ts'

const CHANGES: readonly (readonly [ThemeChange, string, string])[] = [
  [
    {
      kind: 'override-colour',
      token: '--palette-accent-subtle',
      role: 'accentSubtle',
      scopes: ['dark'],
      property: 'chroma',
      from: 0.05,
      to: 0.045,
    },
    'Make the accent wash a little quieter in dark mode',
    '--palette-accent-subtle chroma 0.05 → 0.045 in dark',
  ],
  [
    {
      kind: 'override-colour',
      token: '--palette-foreground',
      role: 'ink',
      scopes: ['light'],
      property: 'lightness',
      from: 95,
      to: 26.5,
    },
    'Make the headings darker in light mode',
    '--palette-foreground lightness 95 → 26.5 in light',
  ],
  [
    {
      kind: 'remove-override',
      token: '--palette-accent-subtle',
      role: 'accentSubtle',
      scopes: ['light', 'dark'],
    },
    'Use the generated accent wash',
    'Removes --palette-accent-subtle from light and dark',
  ],
  [
    { kind: 'neutral-step', scheme: 'dark', role: 'raised', from: 23, to: 24.5 },
    'Lift the dark raised surface a little',
    'Dark raised lightness 23 → 24.5',
  ],
  [
    { kind: 'neutral-step', scheme: 'light', role: 'surface', from: undefined, to: 91.5 },
    'Lift the light panel',
    'Light surface lightness the default → 91.5',
  ],
  [
    { kind: 'accent-chroma', from: 0.2, to: 0.18 },
    'Make the accent a little quieter',
    'Accent chroma 0.2 → 0.18',
  ],
  [
    { kind: 'accent-lightness', scheme: 'dark', from: 78, to: 72 },
    'Make the dark accent a little darker',
    'Dark accent lightness 78 → 72',
  ],
  [
    { kind: 'tone-chroma', from: 0.012, to: 0.006 },
    'Keep your teal and make the greys more neutral',
    'Neutral tint chroma 0.012 → 0.006',
  ],
  [
    { kind: 'tone-hue', from: 150, to: 105 },
    'Keep your teal and warm the greys slightly',
    'Neutral hue 150° → 105°',
  ],
  [
    { kind: 'tone-hue', from: 60, to: 105 },
    'Keep your teal and cool the greys slightly',
    'Neutral hue 60° → 105°',
  ],
  [
    { kind: 'tone-chroma', from: 0.004, to: 0.006 },
    'Keep your teal and give the greys more tint',
    'Neutral tint chroma 0.004 → 0.006',
  ],
  [
    {
      kind: 'ground-shift',
      scheme: 'dark',
      from: { paper: 19, surface: 21.5, raised: 23 },
      by: 1.5,
    },
    'Keep your teal and make the dark page a touch lighter behind it',
    'Dark page lightness 19 → 20.5, panel lightness 21.5 → 23, raised surface lightness 23 → 24.5',
  ],
  [
    {
      kind: 'combined',
      changes: [
        {
          kind: 'override-colour',
          token: '--palette-accent',
          role: 'accent',
          scopes: ['light'],
          property: 'lightness',
          from: 52.5,
          to: 50.5,
        },
        {
          kind: 'ground-shift',
          scheme: 'light',
          from: { paper: 96, surface: 93, raised: 97 },
          by: -1,
        },
      ],
    },
    'Make the accent a little darker in light mode, and make the light page a touch darker behind it',
    '--palette-accent lightness 52.5 → 50.5 in light; Light page lightness 96 → 95, panel lightness 93 → 92, raised surface lightness 97 → 96',
  ],
  [
    {
      kind: 'combined',
      changes: [
        {
          kind: 'ground-shift',
          scheme: 'light',
          from: { paper: 96, surface: 93, raised: 97 },
          by: 1,
        },
        { kind: 'accent-chroma', from: 0.2, to: 0.18 },
      ],
    },
    'Make the light page a touch lighter behind it, and make the accent a little quieter',
    'Light page lightness 96 → 97, panel lightness 93 → 94, raised surface lightness 97 → 98; Accent chroma 0.2 → 0.18',
  ],
  [
    { kind: 'remove-status-overrides', statuses: ['success', 'danger'] },
    'Use the standard success and danger colours',
    'Removes the success and danger status overrides',
  ],
]

describe('the doctor’s suggestions in words', () => {
  it.each(CHANGES)(
    'says %o as a plain instruction, with the numbers kept for Details',
    (change, said, detail) => {
      expect(describeChange(change, 'teal')).toBe(said)
      expect(describeChange(change, 'teal')).not.toMatch(/\d/)
      expect(describeChangeDetail(change)).toBe(detail)
    },
  )
})

describe('the verdict in words', () => {
  it('says what needs a look first, and keeps an accepted warning in view', () => {
    expect(describeVerdict({ warn: 2, adjusted: 4, accepted: 1, pass: 15 })).toBe(
      '2 to check, 4 adjusted, 1 accepted, 15 passing',
    )
    expect(describeVerdict({ warn: 0, adjusted: 4, accepted: 0, pass: 15 })).toBe(
      'All 19 checks pass',
    )
  })
})
