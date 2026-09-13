import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { ANCHOR_OFFSET_PX, SHELL_HEADER_HEIGHT_PX } from './metrics.ts'

/**
 * The pin that keeps the numbers in `metrics.ts` honest: the stylesheet is the
 * source, so if a declaration there changes, this fails rather than leaving a
 * constant quietly describing a bar that is no longer that tall.
 */
const tokensCss = readFileSync('packages/ui/src/styles/tokens.css', { encoding: 'utf8' })

const ROOT_FONT_SIZE_PX = 16

function declaredRem(property: string): number {
  const match = new RegExp(`${property}:\\s*([0-9.]+)rem`).exec(tokensCss)
  expect(match, `${property} is declared in rem in tokens.css`).not.toBeNull()
  return Number(match?.[1])
}

describe('layout metrics', () => {
  it('states the shell header height that tokens.css declares', () => {
    expect(declaredRem('--spacing-shell-header') * ROOT_FONT_SIZE_PX).toBe(SHELL_HEADER_HEIGHT_PX)
  })

  it('derives the anchor offset the way tokens.css does: the bar plus four spacing steps', () => {
    expect(tokensCss).toContain(
      '--anchor-offset: calc(var(--spacing-shell-header) + var(--spacing) * 4)',
    )
    // `--spacing` is 0.25rem at the tuned density (see the `--density-baseline`
    // block in the same file).
    const spacingStepPx = 0.25 * ROOT_FONT_SIZE_PX
    expect(SHELL_HEADER_HEIGHT_PX + spacingStepPx * 4).toBe(ANCHOR_OFFSET_PX)
  })
})
