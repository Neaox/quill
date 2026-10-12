import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { BUILTIN_THEMES, generateTheme, type ThemeDocument } from '@quill/theme'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { themeReport } from './settings-fixtures.ts'
import { focusDoctorGroup, ThemeDoctor } from './theme-doctor.tsx'

/** Grid ships two warnings, four adjustments and the rest passing. */
const { grid, instrument } = BUILTIN_THEMES

/** The editor in miniature: a draft theme, and the report generated from it. */
function Editor({ initial }: { readonly initial: ThemeDocument }) {
  const [theme, setTheme] = useState(initial)
  return (
    <>
      <output aria-label="Raised step">{theme.seeds.tone.steps?.dark?.raised ?? 'none'}</output>
      <ThemeDoctor
        report={generateTheme(theme).report}
        theme={theme}
        contrastEnforcement="enforced"
        onThemeChange={(update) => {
          setTheme(update)
        }}
      />
    </>
  )
}

const report = () => screen.getByRole('list', { name: 'Theme doctor report' })

describe('the theme doctor', () => {
  it('orders the findings by severity, under headings that count them', () => {
    render(<Editor initial={grid} />)

    const headings = within(report())
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual([
      expect.stringMatching(/^Needs a look · 2$/),
      expect.stringMatching(/^Adjusted for you · \d+$/),
      expect.stringMatching(/^Passing · \d+$/),
    ])
  })

  it('leads with the verdict, each count linking to its group', () => {
    render(<Editor initial={grid} />)

    expect(screen.getByRole('link', { name: '2 to check' })).toHaveAttribute(
      'href',
      '#theme-doctor-warn',
    )
    expect(screen.getByRole('link', { name: /adjusted$/ })).toHaveAttribute(
      'href',
      '#theme-doctor-adjusted',
    )
  })

  it('says all is clear in one line when nothing needs a look, with the passes folded away', () => {
    render(<Editor initial={instrument} />)

    expect(screen.getByText(/^All \d+ checks pass$/)).toBeVisible()
    expect(screen.queryByRole('heading', { name: /Needs a look/ })).not.toBeInTheDocument()
    const passing = screen.getByRole('heading', { name: /^Passing/ }).closest('details')
    expect(passing).not.toHaveAttribute('open')
  })

  it('opens a few warnings by itself, showing what was measured in both schemes', () => {
    render(<Editor initial={grid} />)

    const separation = screen.getByRole('button', { name: 'Panels stand apart from the page' })
    expect(separation).toHaveAttribute('aria-expanded', 'true')
    const measured = screen.getByRole('table', {
      name: 'What “Panels stand apart from the page” measured',
    })
    expect(within(measured).getByRole('columnheader', { name: 'Light' })).toBeVisible()
    expect(within(measured).getByRole('columnheader', { name: 'Dark' })).toBeVisible()
    const raised = within(measured).getByRole('row', { name: /A raised card/ })
    expect(raised).toHaveTextContent('Out of range')
  })

  it('opens and closes a finding, and shows an adjustment as set and as shipped', async () => {
    render(<Editor initial={grid} />)

    const fits = screen.getByRole('button', { name: 'Colours fit ordinary screens' })
    expect(fits).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(fits)

    expect(fits).toHaveAttribute('aria-expanded', 'true')
    const measured = screen.getByRole('table', {
      name: 'What “Colours fit ordinary screens” measured',
    })
    expect(within(measured).getAllByText('As set').length).toBeGreaterThan(0)
    expect(within(measured).getAllByText('As shipped').length).toBeGreaterThan(0)

    await userEvent.click(fits)
    expect(fits).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows every pair a rule measured on request, the failures first', async () => {
    render(<Editor initial={grid} />)

    // jsdom does not run a summary's activation behaviour; a browser opens it on click.
    const passing = screen.getByRole('heading', { name: /^Passing/ }).closest('details')
    if (passing === null) throw new Error('the passes are not a disclosure')
    passing.open = true
    await userEvent.click(screen.getByRole('button', { name: /^Text is easy to read/ }))
    const measured = screen.getByRole('table', { name: 'What “Text is easy to read” measured' })
    expect(within(measured).getAllByRole('row')).toHaveLength(5)

    const evidence = measured.parentElement
    if (evidence === null) throw new Error('the table stands alone')
    await userEvent.click(within(evidence).getByRole('button', { name: /^Show all \d+$/ }))
    expect(within(measured).getAllByRole('row').length).toBeGreaterThan(20)
    await userEvent.click(within(evidence).getByRole('button', { name: 'Show fewer' }))
    expect(within(measured).getAllByRole('row')).toHaveLength(5)
  })

  it('keeps the rule’s own terms behind Details', async () => {
    render(<Editor initial={grid} />)

    const row = screen
      .getByRole('button', { name: 'Panels stand apart from the page' })
      .closest('li')
    if (row === null) throw new Error('the finding is not a list item')
    const terms = within(row).getByText(/dark raised surface is only 1.5 from the surface below it/)
    expect(terms.closest('details')).not.toHaveAttribute('open')
  })

  it('suggests a verified fix, and applying it patches the draft without saving', async () => {
    render(<Editor initial={grid} />)

    const fix = await screen.findByText('Lift the dark raised surface a little')
    const card = fix.closest('li')
    if (card === null) throw new Error('the suggestion is not a list item')
    // The raised card now and with the change, drawn on the panel it rises from.
    expect(within(card).getByText(/A raised card, now:/)).toBeInTheDocument()
    expect(within(card).getByText(/with this change:/)).toBeInTheDocument()
    expect(within(card).getByText('Dark raised lightness 23 → 24.5')).toBeInTheDocument()

    await userEvent.click(within(card).getByRole('button', { name: 'Apply' }))

    expect(
      screen.getByText('Applied: Lift the dark raised surface a little. Not saved yet.'),
    ).toBeVisible()
    expect(screen.getByRole('status', { name: 'Raised step' })).toHaveTextContent('24.5')
    expect(screen.getByRole('heading', { name: /^Needs a look/ })).toHaveTextContent('· 1')

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('status', { name: 'Raised step' })).toHaveTextContent('23')
    expect(screen.getByRole('heading', { name: /^Needs a look/ })).toHaveTextContent('· 2')
  })

  it('hides a dismissed suggestion for the rest of the visit', async () => {
    render(<Editor initial={grid} />)

    const fix = await screen.findByText('Lift the dark raised surface a little')
    const card = fix.closest('li')
    if (card === null) throw new Error('the suggestion is not a list item')
    await userEvent.click(within(card).getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText('Lift the dark raised surface a little')).not.toBeInTheDocument()
    expect(screen.getByText(/^No other suggestions\. A raised card stays as set/)).toBeVisible()
  })

  it('says plainly when no fix keeps the brand, and lets the warning be accepted', async () => {
    // A green accent stronger in dark than in light: every fix greys it out.
    const green: ThemeDocument = {
      ...instrument,
      overrides: {
        light: { '--palette-accent': 'oklch(50% 0.05 150)' },
        dark: { '--palette-accent': 'oklch(72% 0.12 150)' },
      },
    }
    render(<Editor initial={green} />)

    const rederivation = screen.getByRole('button', { name: 'Dark mode keeps the same colours' })
    if (rederivation.getAttribute('aria-expanded') === 'false') await userEvent.click(rederivation)
    const row = rederivation.closest('li')
    if (row === null) throw new Error('the finding is not a list item')
    expect(
      await within(row).findByText(
        /^Can’t fix this without losing your .+\. The accent stays as set; the doctor will keep flagging it\.$/,
      ),
    ).toBeVisible()

    await userEvent.click(within(row).getByRole('button', { name: 'Accept as is' }))

    expect(screen.getByRole('heading', { name: /^Accepted/ })).toHaveTextContent('Accepted · 1')
    await userEvent.click(screen.getByRole('button', { name: 'Dark mode keeps the same colours' }))
    expect(screen.getByText('You accepted this as part of the theme.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Flag it again' }))
    expect(screen.queryByRole('heading', { name: /^Accepted/ })).not.toBeInTheDocument()
  })

  it('keeps the brand and offers to move the greys instead, with no need to accept anything', async () => {
    // A tinted grey at an awkward angle to the accent: the accent's hue is
    // the brand and does not move, so the greys do.
    const clashing: ThemeDocument = {
      ...instrument,
      seeds: {
        tone: { hue: 150, chroma: 0.012 },
        accent: { hue: 45, chroma: 0.15, lightness: 50 },
      },
    }
    render(<Editor initial={clashing} />)

    const rule = screen.getByRole('button', { name: 'Greys suit the accent' })
    const row = rule.closest('li')
    if (row === null) throw new Error('the finding is not a list item')
    expect(
      await within(row).findAllByText(
        /^Keep your .+ and (warm|cool) the greys slightly$|^Keep your .+ and make the greys more neutral$/,
      ),
    ).not.toHaveLength(0)
    expect(within(row).queryByRole('button', { name: 'Accept as is' })).not.toBeInTheDocument()
  })

  it('offers no fixes when it cannot change the draft', () => {
    render(
      <ThemeDoctor
        report={generateTheme(grid).report}
        theme={grid}
        contrastEnforcement="enforced"
      />,
    )

    expect(screen.queryByText('Looking for fixes…')).not.toBeInTheDocument()
  })

  it('takes the reader to a group on request', () => {
    render(<Editor initial={grid} />)
    const scrollIntoView = vi.fn<() => void>()
    const heading = screen.getByRole('heading', { name: /^Needs a look/ })
    heading.scrollIntoView = scrollIntoView

    focusDoctorGroup('warn')

    expect(heading).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it('puts an AA failure in front of the switch that makes it advisory', async () => {
    const relax = vi.fn<() => void>()
    render(
      <ThemeDoctor
        report={themeReport({ enforcedWarns: true })}
        theme={instrument}
        contrastEnforcement="enforced"
        onRelaxEnforcement={relax}
      />,
    )

    expect(screen.getByText('Text contrast does not meet AA')).toBeVisible()
    expect(screen.getByText(/This theme still saves/)).toBeVisible()
    expect(screen.getByText(/Required for AA/)).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Make contrast enforcement advisory' }),
    )
    expect(relax).toHaveBeenCalledOnce()
  })

  it('offers no switch when enforcement is already advisory, and says so when all holds', () => {
    const { rerender } = render(
      <ThemeDoctor
        report={themeReport({ enforcedWarns: true })}
        theme={instrument}
        contrastEnforcement="advisory"
        onRelaxEnforcement={() => undefined}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Make contrast enforcement advisory' }),
    ).not.toBeInTheDocument()

    rerender(
      <ThemeDoctor report={themeReport()} theme={instrument} contrastEnforcement="advisory" />,
    )
    expect(screen.getByText(/Contrast enforcement is advisory on this instance/)).toBeVisible()
  })

  it('has no accessibility violations, with warnings, fixes and evidence open', async () => {
    const { container } = render(<Editor initial={grid} />)

    await screen.findByText('Lift the dark raised surface a little')
    await userEvent.click(screen.getByRole('button', { name: 'Colours fit ordinary screens' }))
    await waitFor(async () => {
      await expectNoAccessibilityViolations(container)
    })
  })
})
