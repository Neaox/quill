import { CHILD_DEPTHS, HEADING_LEVELS, tocLevels } from '@quill/markdown'
import type { ChildDepth, HeadingLevel } from '@quill/markdown'

/**
 * The settings of the two navigation blocks, as pure functions of their
 * attributes. The controls on a block turn an author's choice into the new
 * attribute record; what the choices are, and how two of them constrain each
 * other, is decided here and not in the component that draws the select.
 */

export type Attributes = Readonly<Record<string, string>>

/**
 * Raising the first level past the last drags the last up with it, and lowering
 * the last below the first drags the first down: the range can never be empty,
 * so there is no state of the control that lists nothing by construction.
 */
export function withTocMin(attributes: Attributes, min: HeadingLevel): Attributes {
  const settings = tocLevels(attributes)
  return { ...attributes, min: String(min), max: String(Math.max(settings.max, min)) }
}

export function withTocMax(attributes: Attributes, max: HeadingLevel): Attributes {
  const settings = tocLevels(attributes)
  return { ...attributes, min: String(Math.min(settings.min, max)), max: String(max) }
}

export function withDepth(attributes: Attributes, depth: ChildDepth): Attributes {
  return { ...attributes, depth: String(depth) }
}

export const TOC_LEVEL_CHOICES: readonly HeadingLevel[] = HEADING_LEVELS
export const DEPTH_CHOICES: readonly ChildDepth[] = CHILD_DEPTHS

export function levelLabel(level: HeadingLevel): string {
  return `Heading ${String(level)}`
}

export function depthLabel(depth: ChildDepth): string {
  return depth === 1 ? '1 level' : `${String(depth)} levels`
}
