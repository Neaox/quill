import axe, { type AxeResults, type RunOptions } from 'axe-core'
import { expect } from 'vitest'

/**
 * Runs axe-core against a rendered container and fails with a readable report
 * if any violation is found.
 *
 * This lives outside `src` on purpose: it is test scaffolding, not part of the
 * published surface of the package.
 */
export async function expectNoAccessibilityViolations(
  container: Element,
  options: RunOptions = {},
): Promise<void> {
  const { rules, ...rest } = options
  const results: AxeResults = await axe.run(container, {
    ...rest,
    rules: {
      // Colour contrast cannot be evaluated in jsdom, which does not do layout
      // or resolve custom properties; contrast is verified numerically instead
      // (see docs/research/r13-frontend.md).
      'color-contrast': { enabled: false },
      ...rules,
    },
  })

  const report = results.violations
    .map((violation) => {
      const nodes = violation.nodes.map((node) => `      ${node.html}`).join('\n')
      return `  ${violation.id}: ${violation.help}\n${nodes}`
    })
    .join('\n')

  expect(report, `axe found accessibility violations:\n${report}`).toBe('')
}
