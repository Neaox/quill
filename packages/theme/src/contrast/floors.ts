/**
 * The measured floors from `docs/design/colour-rules.md`, section 1.
 *
 * "Body" is the reading ink, and it carries the full body floor.
 *
 * "Secondary" is text that is deliberately quieter than the ink — muted
 * metadata, accent links. It keeps the AA ratio in full, which is the rule
 * ADR-028 enforces, but takes its APCA floor from the "UI boundaries" row
 * rather than the body row. That is not a softening for convenience: section
 * 3's committed dark-mode bands put muted text at L 65 to 75 over paper at
 * L 15 to 22, which caps APCA below Lc 60 however the hue is chosen, so a body
 * APCA floor on secondary text would make the band system unsatisfiable.
 */

export type ContrastFloor = {
  readonly ratio: number
  readonly lc: number
}

export const CONTRAST_FLOORS = {
  body: { ratio: 4.5, lc: 75 },
  secondary: { ratio: 4.5, lc: 45 },
  largeText: { ratio: 3, lc: 60 },
  nonText: { ratio: 3, lc: 45 },
} as const satisfies Record<string, ContrastFloor>

/** Placeholder and decorative text: readable when you look, quiet when you do not. */
export const DECORATIVE_LC_BAND = { low: 30, high: 45 } as const
