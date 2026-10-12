import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ACCENT_SWATCHES, choiceOfSwatch, type ColourChoice } from '@quill/theme'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { ColourControl, REMEMBERED_WAY_KEY } from './colour-control.tsx'

const [rose, coral] = ACCENT_SWATCHES

/** A controlled control that records every choice, as the theme page drives it. */
function Harness({
  initial,
  compact = false,
  onChoice,
}: {
  readonly initial: ColourChoice
  readonly compact?: boolean
  readonly onChoice?: (choice: ColourChoice) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <ColourControl
      label="Accent"
      value={value}
      compact={compact}
      onValueChange={(choice) => {
        setValue(choice)
        onChoice?.(choice)
      }}
    />
  )
}

afterEach(() => {
  globalThis.localStorage.clear()
})

describe('ColourControl', () => {
  it('offers four ways to choose, as tabs, with no accessibility violations', async () => {
    const { container } = render(<Harness initial={choiceOfSwatch(rose)} />)

    expect(screen.getByRole('group', { name: 'Accent' })).toBeVisible()
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Swatches', 'Brand', 'Sliders', 'Words'])
    await expectNoAccessibilityViolations(container)
  })

  it.each(['Brand', 'Sliders', 'Words'])('has no accessibility violations on %s', async (name) => {
    const { container } = render(<Harness initial={choiceOfSwatch(rose)} />)
    await userEvent.click(screen.getByRole('tab', { name }))
    await expectNoAccessibilityViolations(container)
  })

  it('moves between tabs with the arrow keys', async () => {
    render(<Harness initial={choiceOfSwatch(rose)} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Swatches' }))
    await userEvent.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Brand', selected: true })).toHaveFocus()
  })

  it('checks the matching swatch, by name, and chooses another', async () => {
    const onChoice = vi.fn<(choice: ColourChoice) => void>()
    render(<Harness initial={choiceOfSwatch(rose)} onChoice={onChoice} />)

    expect(screen.getByRole('radiogroup', { name: 'Accent swatches' })).toBeVisible()
    expect(screen.getByRole('radio', { name: rose.name })).toBeChecked()

    await userEvent.click(screen.getByRole('radio', { name: coral.name }))

    expect(onChoice).toHaveBeenLastCalledWith({ hue: coral.hue, chroma: coral.chroma })
    expect(screen.getByRole('radio', { name: coral.name })).toBeChecked()
  })

  it('shows a custom colour as an extra swatch, checked, named by its value', async () => {
    const custom = { hue: 184, chroma: 0.098, lightness: 57.1 }
    const { container } = render(<Harness initial={custom} />)

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(ACCENT_SWATCHES.length + 1)
    const extra = screen.getByRole('radio', { name: /^Custom, #[0-9a-f]{6}$/u })
    expect(radios.at(-1)).toBe(extra)
    expect(extra).toBeChecked()
    expect(screen.getByTitle(/^Custom, #[0-9a-f]{6}$/u)).toBeVisible()
    expect(screen.queryByText(/custom one/)).toBeNull()
    await expectNoAccessibilityViolations(container)
  })

  it('names the custom swatch with the value the Brand tab shows', async () => {
    render(<Harness initial={{ hue: 184, chroma: 0.098, lightness: 57.1 }} />)
    const hex = screen
      .getByTitle(/^Custom, /)
      .getAttribute('title')
      ?.replace('Custom, ', '')

    await userEvent.click(screen.getByRole('tab', { name: 'Brand' }))

    expect(screen.getByRole('textbox', { name: 'Brand colour' })).toHaveValue(hex)
  })

  it('replaces the custom swatch when another is chosen', async () => {
    const onChoice = vi.fn<(choice: ColourChoice) => void>()
    render(<Harness initial={{ hue: 12, chroma: 0.1, lightness: 40 }} onChoice={onChoice} />)

    await userEvent.click(screen.getByRole('radio', { name: coral.name }))

    expect(onChoice).toHaveBeenLastCalledWith({ hue: coral.hue, chroma: coral.chroma })
    expect(screen.getByRole('radio', { name: coral.name })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /^Custom/ })).toBeNull()
  })

  it('offers no custom swatch when the colour is one of the swatches', () => {
    render(<Harness initial={choiceOfSwatch(rose)} />)

    expect(screen.getAllByRole('radio')).toHaveLength(ACCENT_SWATCHES.length)
  })

  it('reads a brand colour in any format, keeps its lightness, and names the format', async () => {
    const onChoice = vi.fn<(choice: ColourChoice) => void>()
    render(<Harness initial={choiceOfSwatch(rose)} onChoice={onChoice} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Brand' }))

    const field = screen.getByRole('textbox', { name: 'Brand colour' })
    fireEvent.change(field, { target: { value: 'hsl(174 80% 30%)' } })

    expect(onChoice).toHaveBeenLastCalledWith({ hue: 183.78, chroma: 0.0982, lightness: 56.96 })
    expect(field).toHaveValue('hsl(174 80% 30%)')
    expect(field).toHaveAccessibleDescription(/Read as HSL\. Kept your hue/)
  })

  it('says why a brand colour does not read, and leaves the choice alone', async () => {
    const onChoice = vi.fn<(choice: ColourChoice) => void>()
    const { container } = render(<Harness initial={choiceOfSwatch(rose)} onChoice={onChoice} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Brand' }))

    const field = screen.getByRole('textbox', { name: 'Brand colour' })
    fireEvent.change(field, { target: { value: '#12' } })
    expect(field).toBeInvalid()
    expect(field).toHaveAccessibleDescription(/looks like hex but is not a valid one\. Use hex/)
    await expectNoAccessibilityViolations(container)

    fireEvent.change(field, { target: { value: 'pantone 3278 c' } })
    expect(field).toHaveAccessibleDescription(/not a colour format we know/)

    fireEvent.change(field, { target: { value: '' } })
    expect(field).not.toBeInvalid()
    expect(onChoice).not.toHaveBeenCalled()
  })

  it('takes a colour from the colour well, and shows it as hex', async () => {
    const onChoice = vi.fn<(choice: ColourChoice) => void>()
    render(<Harness initial={choiceOfSwatch(rose)} onChoice={onChoice} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Brand' }))

    fireEvent.change(screen.getByLabelText('Pick the brand colour'), {
      target: { value: '#0f8a7e' },
    })

    expect(onChoice).toHaveBeenLastCalledWith({ hue: 184.01, chroma: 0.0983, lightness: 57.05 })
    expect(screen.getByRole('textbox', { name: 'Brand colour' })).toHaveValue('#0f8a7e')
  })

  it('copies the colour in the format chosen', async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ hue: 184, chroma: 0.098, lightness: 57.1 }} />)
    await user.click(screen.getByRole('tab', { name: 'Brand' }))

    await user.click(screen.getByRole('button', { name: 'Copy the colour as' }))
    await user.click(screen.getByRole('menuitem', { name: /^rgb\(/u }))

    expect(await screen.findByRole('status')).toHaveTextContent(/^Copied rgb\(/u)
    expect(await navigator.clipboard.readText()).toMatch(/^rgb\(/u)
  })

  it('reads the sliders in words, with the number beside, and moves the hue alone', async () => {
    const onChoice = vi.fn<(choice: ColourChoice) => void>()
    render(<Harness initial={{ hue: 184, chroma: 0.13, lightness: 48 }} onChoice={onChoice} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Sliders' }))

    expect(screen.getByLabelText('Colour')).toHaveValue('184')
    expect(screen.getByText('Teal')).toBeVisible()
    expect(screen.getByText('184°')).toBeVisible()
    expect(screen.getByText('Balanced')).toBeVisible()

    fireEvent.change(screen.getByLabelText('Colour'), { target: { value: '300' } })
    expect(onChoice).toHaveBeenLastCalledWith({ hue: 300, chroma: 0.13, lightness: 48 })

    fireEvent.change(screen.getByLabelText('Muted ↔ Vivid'), { target: { value: '0.15' } })
    expect(onChoice).toHaveBeenLastCalledWith({ hue: 300, chroma: 0.15, lightness: 48 })
  })

  it('chooses a family and a strength in words', async () => {
    const onChoice = vi.fn<(choice: ColourChoice) => void>()
    render(<Harness initial={{ hue: 184, chroma: 0.13 }} onChoice={onChoice} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Words' }))

    expect(screen.getByRole('radio', { name: 'Teal' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Balanced' })).toBeChecked()

    await userEvent.click(screen.getByRole('radio', { name: 'Purple' }))
    expect(onChoice).toHaveBeenLastCalledWith({ hue: 300, chroma: 0.13 })

    await userEvent.click(screen.getByRole('radio', { name: 'Bold' }))
    expect(onChoice).toHaveBeenLastCalledWith({ hue: 300, chroma: 0.18 })
  })

  it('keeps the choice across tabs, and remembers the last tab for this viewer', async () => {
    const first = render(<Harness initial={choiceOfSwatch(rose)} />)
    await userEvent.click(screen.getByRole('radio', { name: coral.name }))
    await userEvent.click(screen.getByRole('tab', { name: 'Words' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Swatches' }))
    expect(screen.getByRole('radio', { name: coral.name })).toBeChecked()

    await userEvent.click(screen.getByRole('tab', { name: 'Sliders' }))
    first.unmount()

    render(<Harness initial={choiceOfSwatch(rose)} />)
    expect(screen.getByRole('tab', { name: 'Sliders', selected: true })).toBeVisible()
  })

  it('offers swatches and a brand colour alone when compact, whatever tab was last used', () => {
    globalThis.localStorage.setItem(REMEMBERED_WAY_KEY, 'words')
    render(<Harness initial={choiceOfSwatch(rose)} compact />)

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Swatches', 'Brand'])
    expect(screen.getByRole('tab', { name: 'Swatches', selected: true })).toBeVisible()
  })
})
