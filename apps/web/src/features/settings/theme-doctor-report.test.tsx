import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { describeAdjustmentView, ThemeDoctorReport } from './theme-doctor-report.tsx'
import { themeReport } from './settings-fixtures.ts'

describe('the theme doctor report', () => {
  it('reports every rule as pass, adjusted or warn, with its reason', () => {
    render(<ThemeDoctorReport report={themeReport()} contrastEnforcement="enforced" />)

    const rules = screen.getByRole('list', { name: 'Theme doctor report' })
    expect(rules).toHaveTextContent('Text meets AA')
    expect(rules).toHaveTextContent('every pair is above 4.5')
    expect(rules).toHaveTextContent('Adjusted')
    expect(rules).toHaveTextContent('accent chroma reduced to fit sRGB')
  })

  it('counts the three statuses', () => {
    render(<ThemeDoctorReport report={themeReport()} contrastEnforcement="enforced" />)

    expect(screen.getByText('1 pass · 1 adjusted · 0 warn')).toBeVisible()
  })

  it('names every place the generator changed what the seeds asked for', () => {
    render(<ThemeDoctorReport report={themeReport()} contrastEnforcement="enforced" />)

    expect(screen.getByRole('list', { name: 'Generator adjustments' })).toHaveTextContent(
      'accent chroma 0.2 to 0.185 (gamut)',
    )
  })

  /**
   * `adjustments` is the light palette's log followed by the dark one's, and
   * the two regularly make the same correction with different numbers. Keying
   * by role, property and reason made those duplicate React keys — which the
   * settings journey caught as a console error, and which licenses React to
   * drop one of the pair.
   */
  it('lists both schemes’ corrections when they are of the same kind', () => {
    const report = themeReport()
    render(
      <ThemeDoctorReport
        report={{
          ...report,
          adjustments: [
            { role: 'accent', property: 'chroma', reason: 'gamut', from: 0.2, to: 0.185 },
            { role: 'accent', property: 'chroma', reason: 'gamut', from: 0.2, to: 0.118 },
          ],
        }}
        contrastEnforcement="enforced"
      />,
    )

    const list = screen.getByRole('list', { name: 'Generator adjustments' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(list).toHaveTextContent('accent chroma 0.2 to 0.185 (gamut)')
    expect(list).toHaveTextContent('accent chroma 0.2 to 0.118 (gamut)')
  })

  it('marks the one rule that is enforced', () => {
    render(<ThemeDoctorReport report={themeReport()} contrastEnforcement="enforced" />)

    expect(screen.getByText(/Text meets AA \(enforced\)/)).toBeVisible()
  })

  it('puts an AA failure in front of the switch that makes it advisory', async () => {
    const relax = vi.fn<() => void>()
    render(
      <ThemeDoctorReport
        report={themeReport({ enforcedWarns: true })}
        contrastEnforcement="enforced"
        onRelaxEnforcement={relax}
      />,
    )

    expect(screen.getByText('Text contrast does not meet AA')).toBeVisible()
    // Once in the callout that asks for a decision, once in the rule list.
    expect(screen.getAllByText('body on surface is 3.1:1, below 4.5:1')).toHaveLength(2)
    // ADR-028: the doctor advises, it never blocks — the screen says so where
    // the finding is, not in a refusal.
    expect(screen.getByText(/This theme still saves/)).toBeVisible()

    await userEvent.click(
      screen.getByRole('button', { name: 'Make contrast enforcement advisory' }),
    )

    expect(relax).toHaveBeenCalledOnce()
  })

  it('offers no switch when enforcement is already advisory', () => {
    render(
      <ThemeDoctorReport
        report={themeReport({ enforcedWarns: true })}
        contrastEnforcement="advisory"
        onRelaxEnforcement={() => undefined}
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'Make contrast enforcement advisory' }),
    ).not.toBeInTheDocument()
  })

  it('says when enforcement is advisory and nothing enforced is failing', () => {
    render(<ThemeDoctorReport report={themeReport()} contrastEnforcement="advisory" />)

    expect(screen.getByText(/Contrast enforcement is advisory on this instance/)).toBeVisible()
  })

  it('rounds each adjusted property to the places it is worth reading at', () => {
    expect(
      describeAdjustmentView({
        role: 'accent',
        property: 'lightness',
        reason: 'contrast',
        from: 62.04,
        to: 48.19,
      }),
    ).toBe('accent lightness 62 to 48.2 (contrast)')
    expect(
      describeAdjustmentView({
        role: 'accent',
        property: 'saturation',
        reason: 'budget',
        from: 1.239,
        to: 1.1,
      }),
    ).toBe('accent saturation 1.24 to 1.1 (budget)')
  })

  it('has no accessibility violations', async () => {
    const { container } = render(
      <ThemeDoctorReport
        report={themeReport({ enforcedWarns: true })}
        contrastEnforcement="enforced"
        onRelaxEnforcement={() => undefined}
      />,
    )

    await expectNoAccessibilityViolations(container)
  })
})
