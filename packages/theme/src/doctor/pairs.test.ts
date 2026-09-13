import { describe, expect, it } from 'vitest'
import { instrument } from '../builtin/instrument.ts'
import { buildPalettes } from '../colour/palette.ts'
import { CONTRAST_FLOORS } from '../contrast/floors.ts'
import {
  boundaryPairs,
  describe as describePair,
  holds,
  lcOf,
  ratioOf,
  syntaxPairs,
  textPairs,
} from './pairs.ts'

const { light } = buildPalettes(instrument)

describe('pairs', () => {
  it('covers the surfaces text is actually rendered on', () => {
    const labels = textPairs(light).map((pair) => pair.label)
    expect(labels).toContain('ink on paper')
    expect(labels).toContain('accent foreground on accent')
    expect(labels).toContain('ink on danger-subtle')
  })

  it('names a pair for every syntax family', () => {
    expect(syntaxPairs(light)).toHaveLength(10)
  })

  it('measures the focus ring against every ground it can appear on', () => {
    expect(boundaryPairs(light).map((pair) => pair.label)).toEqual([
      'focus ring on paper',
      'focus ring on surface',
      'focus ring on raised',
      'strong border on paper',
      'strong border on surface',
    ])
  })

  it('holds when both the ratio and the APCA floor are met', () => {
    const inkOnPaper = {
      label: 'ink on paper',
      foreground: light.colours.ink,
      background: light.colours.paper,
      floor: CONTRAST_FLOORS.body,
    }
    expect(ratioOf(inkOnPaper)).toBeGreaterThan(4.5)
    expect(lcOf(inkOnPaper)).toBeGreaterThan(75)
    expect(holds(inkOnPaper)).toBe(true)
  })

  it('describes a failure with both numbers and the floor it missed', () => {
    const failing = {
      label: 'ink on paper',
      foreground: light.colours.paper,
      background: light.colours.paper,
      floor: CONTRAST_FLOORS.body,
    }
    expect(holds(failing)).toBe(false)
    expect(describePair(failing)).toBe('ink on paper is 1.00:1 and Lc 0, below 4.5:1 and Lc 75')
  })
})
