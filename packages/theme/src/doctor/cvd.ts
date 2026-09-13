import { converter } from 'culori'
import { toCulori, type Colour } from '../colour/oklch.ts'

export type Deficiency = 'protan' | 'deutan' | 'tritan'

export const DEFICIENCIES: readonly Deficiency[] = ['protan', 'deutan', 'tritan']

/**
 * Machado, Oliveira and Fernandes (2009) severity-1.0 matrices, applied in
 * linear RGB. They are the matrices browsers and design tools use, and unlike
 * a naive channel swap they keep the lightness shift that is most of what a
 * red and a green still have between them.
 */
type Row = readonly [number, number, number]

const MATRICES: Record<Deficiency, readonly [Row, Row, Row]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.96864],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

const toLrgb = converter('lrgb')
const toOklabColour = converter('oklab')

const clampChannel = (value: number): number => Math.min(Math.max(value, 0), 1)

/** Simulate how a colour is seen with the given deficiency. */
export const simulate = (colour: Colour, deficiency: Deficiency): Colour => {
  const { r, g, b } = toLrgb(toCulori(colour))
  const [redRow, greenRow, blueRow] = MATRICES[deficiency]
  const apply = (row: Row): number => clampChannel(row[0] * r + row[1] * g + row[2] * b)
  const lab = toOklabColour({
    mode: 'lrgb',
    r: apply(redRow),
    g: apply(greenRow),
    b: apply(blueRow),
  })
  return {
    lightness: lab.l * 100,
    chroma: Math.hypot(lab.a, lab.b),
    hue: ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360,
  }
}

/**
 * Difference in OKLab on the 0 to 100 scale the colour rules quote, so the
 * "at least 20" of section 8 reads against the same numbers.
 */
export const deltaEOklab = (a: Colour, b: Colour): number => {
  const first = toOklabColour(toCulori(a))
  const second = toOklabColour(toCulori(b))
  return 100 * Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b)
}

export type SeparationResult = {
  readonly deficiency: Deficiency
  readonly pair: readonly [string, string]
  readonly deltaE: number
}

export type NamedColour = readonly [name: string, colour: Colour]

/**
 * The weakest pair, under the worst deficiency. Two colours are required
 * because a separation between fewer than two is not a measurement, which
 * keeps the result total.
 */
export const worstSeparation = (
  first: NamedColour,
  second: NamedColour,
  ...rest: readonly NamedColour[]
): SeparationResult => {
  const entries = [first, second, ...rest]
  const results = DEFICIENCIES.flatMap((deficiency) =>
    entries.flatMap(([firstName, firstColour], index) =>
      entries.slice(index + 1).map(([secondName, secondColour]): SeparationResult => ({
        deficiency,
        pair: [firstName, secondName],
        deltaE: deltaEOklab(simulate(firstColour, deficiency), simulate(secondColour, deficiency)),
      })),
    ),
  )
  return results.reduce((worst, result) => (result.deltaE < worst.deltaE ? result : worst))
}

/** The weakest of one pair across the three deficiencies. */
export const pairSeparation = (name: string, a: Colour, other: string, b: Colour) =>
  worstSeparation([name, a], [other, b])
