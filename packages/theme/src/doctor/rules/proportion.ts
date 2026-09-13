import { MAX_ACCENT_COVERAGE } from '../../colour/bands.ts'
import { pass, round, warn, type Rule } from '../rule.ts'

/**
 * Section 6: roughly 60 percent paper, 30 percent surfaces and text, 10
 * percent accent. Coverage is a property of a rendered view, not of a palette,
 * so the doctor reports it only when the preview has measured it.
 */
export const accentCoverageRule: Rule = {
  id: 'proportion/accent-coverage',
  section: 6,
  title: 'The accent covers no more than 12 percent of the view',
  evaluate: (_theme, _palettes, options) => {
    const coverage = options.accentCoverage
    if (coverage === undefined) {
      return pass('accent coverage is measured in the live preview and was not supplied')
    }
    return coverage > MAX_ACCENT_COVERAGE
      ? warn(
          `the accent covers ${round(coverage * 100, 1)} percent of the view, over ${
            MAX_ACCENT_COVERAGE * 100
          } percent`,
        )
      : pass(`the accent covers ${round(coverage * 100, 1)} percent of the view`)
  },
}
