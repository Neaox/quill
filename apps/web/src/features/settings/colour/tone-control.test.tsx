import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ToneSeedValue } from '@quill/theme'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { ToneControl } from './tone-control.tsx'

const ACCENT_HUE = 30

function Harness({
  initial,
  onTone,
}: {
  readonly initial: ToneSeedValue
  readonly onTone?: (tone: ToneSeedValue) => void
}) {
  const [tone, setTone] = useState(initial)
  return (
    <ToneControl
      tone={tone}
      accentHue={ACCENT_HUE}
      onToneChange={(next) => {
        setTone(next)
        onTone?.(next)
      }}
    />
  )
}

describe('ToneControl', () => {
  it('reads the greys in words, with no accessibility violations', async () => {
    const { container } = render(<Harness initial={{ hue: 250, chroma: 0.004 }} />)

    expect(screen.getByRole('group', { name: 'Greys' })).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Cool' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Subtle' })).toBeChecked()
    await expectNoAccessibilityViolations(container)
  })

  it('sets a temperature and a tint, keeping what else the tone carries', async () => {
    const onTone = vi.fn<(tone: ToneSeedValue) => void>()
    const steps = { light: { paper: 98 } }
    render(<Harness initial={{ hue: 250, chroma: 0.004, steps }} onTone={onTone} />)

    await userEvent.click(screen.getByRole('radio', { name: 'Neutral' }))
    expect(onTone).toHaveBeenLastCalledWith({ hue: ACCENT_HUE, chroma: 0.004, steps })

    await userEvent.click(screen.getByRole('radio', { name: 'Tinted' }))
    expect(onTone).toHaveBeenLastCalledWith({ hue: ACCENT_HUE, chroma: 0.012, steps })
  })

  it('chooses neither word for a fine-tuned tone, and keeps the exact values one disclosure away', async () => {
    const onTone = vi.fn<(tone: ToneSeedValue) => void>()
    render(<Harness initial={{ hue: 120, chroma: 0.03 }} onTone={onTone} />)

    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked()

    await userEvent.click(screen.getByText('Fine-tune'))
    expect(screen.getByLabelText('Grey hue')).toHaveValue('120')
    expect(screen.getAllByText('Custom')).toHaveLength(2)

    fireEvent.change(screen.getByLabelText('Grey hue'), { target: { value: '70' } })
    expect(onTone).toHaveBeenLastCalledWith({ hue: 70, chroma: 0.03 })
    expect(screen.getByRole('radio', { name: 'Warm' })).toBeChecked()

    fireEvent.change(screen.getByLabelText('Grey tint'), { target: { value: '0.012' } })
    expect(screen.getByRole('radio', { name: 'Tinted' })).toBeChecked()
  })
})
