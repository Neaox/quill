import axe, { type AxeResults, type RunOptions } from 'axe-core'
import { expect } from 'vitest'

/**
 * Runs axe-core against a rendered container and fails with a readable report
 * if any violation is found.
 *
 * Mirrors `packages/ui/testing/axe.ts`: this package renders its own DOM
 * (node views, CodeMirror hosts) that the UI package's helper never sees, so
 * the editor keeps its own copy rather than depending on `@quill/ui`'s test
 * scaffolding, which is not part of its published surface.
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
