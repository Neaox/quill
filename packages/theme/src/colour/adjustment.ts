/**
 * Every place the generator changed what the tenant asked for is recorded, so
 * the doctor can report "adjusted" with the adjustment named rather than
 * quietly substituting a colour (ADR-028).
 */

export type AdjustmentReason =
  | 'gamut'
  | 'contrast'
  | 'band'
  | 'budget'
  | 'separation'
  | 'compensation'

export type Adjustment = {
  readonly role: string
  readonly property: 'lightness' | 'chroma' | 'hue'
  readonly reason: AdjustmentReason
  readonly from: number
  readonly to: number
}

const PLACES: Record<Adjustment['property'], number> = { lightness: 1, chroma: 4, hue: 1 }

const format = (value: number, places: number): string => {
  const factor = 10 ** places
  return String(Math.round(value * factor) / factor)
}

export const describeAdjustment = (adjustment: Adjustment): string => {
  const places = PLACES[adjustment.property]
  return `${adjustment.role} ${adjustment.property} ${format(adjustment.from, places)} to ${format(
    adjustment.to,
    places,
  )} (${adjustment.reason})`
}
