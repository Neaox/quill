import { type Static, type TLiteral, type TUnion, Type } from '@sinclair/typebox'

/**
 * Layout: the bounded set of signature variants, chosen per workspace with an
 * organisation default (ADR-028, amendment of 12 September 2026).
 *
 * These used to be the theme document's `variants` block, and the amendment
 * separates them: a theme is identity and never varies inside an
 * organisation, where a product workspace may reasonably want coloured
 * collection tabs and cards while an engineering workspace wants a tree and
 * hairlines. Every value here is a real component variant with tests, which
 * is what keeps the set bounded on purpose: adding one is a design decision,
 * not a CSS tweak.
 *
 * The schema is the source of truth and the runtime lists are read back out
 * of it, rather than the other way round. Building the schema from a list
 * costs the literal types — a union assembled by mapping an array is an array
 * of schemas rather than a tuple of them, which is enough to make
 * `StaticDecode` (what the HTTP layer resolves a response type with) collapse
 * to `never`.
 */

export const LayoutSchema = Type.Object(
  {
    comments: Type.Union([Type.Literal('sidenotes'), Type.Literal('panel')]),
    history: Type.Union([Type.Literal('timeline'), Type.Literal('menu')]),
    navigation: Type.Union([Type.Literal('tabs'), Type.Literal('tree')]),
    header: Type.Union([Type.Literal('readout'), Type.Literal('breadcrumb')]),
    rules: Type.Union([Type.Literal('double'), Type.Literal('hairline'), Type.Literal('cards')]),
  },
  { additionalProperties: false },
)

export type Layout = Static<typeof LayoutSchema>
export type LayoutSlot = keyof Layout

export const LAYOUT_SLOTS = [
  'comments',
  'history',
  'navigation',
  'header',
  'rules',
] as const satisfies readonly LayoutSlot[]

const choicesOf = <T extends string>(union: TUnion<TLiteral<T>[]>): readonly T[] =>
  union.anyOf.map((literal) => literal.const)

/** What each slot may be, for a settings screen and for the tests. */
export const LAYOUT_CHOICES = {
  comments: choicesOf(LayoutSchema.properties.comments),
  history: choicesOf(LayoutSchema.properties.history),
  navigation: choicesOf(LayoutSchema.properties.navigation),
  header: choicesOf(LayoutSchema.properties.header),
  rules: choicesOf(LayoutSchema.properties.rules),
}
