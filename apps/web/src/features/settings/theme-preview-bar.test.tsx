import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { BUILTIN_THEMES, generateTheme } from '@quill/theme'
import { Button } from '@quill/ui'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { ThemePreviewBar } from './theme-preview-bar.tsx'

const generated = generateTheme(BUILTIN_THEMES.grid, { textContrast: 'enforced' })
const SUMMARY = { pass: 15, adjusted: 4, accepted: 0, warn: 3 }

function renderBar(onReview = vi.fn<() => void>()) {
  return render(
    <main>
      <ThemePreviewBar
        light={generated.light}
        dark={generated.dark}
        summary={SUMMARY}
        onReview={onReview}
        save={
          <Button size="xl" onClick={vi.fn<() => void>()}>
            Save
          </Button>
        }
      />
    </main>,
  )
}

describe('the theme preview bar', () => {
  it('carries the doctor’s verdict and the Save action where the thumb is', () => {
    renderBar()

    const bar = screen.getByRole('region', { name: 'Theme actions' })
    expect(within(bar).getByText('3 to check · 4 adjusted · 15 passing')).toBeVisible()
    expect(within(bar).getByRole('button', { name: 'Save' })).toBeVisible()
    // The verdict describes the button rather than renaming it, so voice
    // control still answers to the word on it.
    expect(within(bar).getByRole('button', { name: 'Preview' })).toHaveAccessibleDescription(
      '3 to check · 4 adjusted · 15 passing',
    )
  })

  it('opens the preview in a sheet, one scheme at a time', async () => {
    renderBar()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))

    const sheet = await screen.findByRole('dialog', { name: 'Preview' })
    expect(sheet).toHaveClass('dialog-sheet')
    expect(within(sheet).getByRole('radio', { name: 'Light' })).toBeChecked()
    expect(sheet.querySelector('[data-scheme="light"]')).not.toBeNull()
    expect(sheet.querySelector('[data-scheme="dark"]')).toBeNull()
  })

  it('switches the scheme from inside the sheet', async () => {
    renderBar()

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    const sheet = await screen.findByRole('dialog', { name: 'Preview' })
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Dark' }))

    expect(within(sheet).getByRole('radio', { name: 'Dark' })).toBeChecked()
    expect(sheet.querySelector('[data-scheme="dark"]')).not.toBeNull()
    expect(sheet.querySelector('[data-scheme="light"]')).toBeNull()
  })

  it('closes, and gives focus back to the bar', async () => {
    renderBar()

    const open = screen.getByRole('button', { name: 'Preview' })
    await userEvent.click(open)
    const sheet = await screen.findByRole('dialog', { name: 'Preview' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(open).toHaveFocus()
  })

  it('closes on Escape', async () => {
    renderBar()

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByRole('dialog', { name: 'Preview' })
    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('has no accessibility violations, closed or open', async () => {
    const { container } = renderBar()
    await expectNoAccessibilityViolations(container)

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await expectNoAccessibilityViolations(await screen.findByRole('dialog', { name: 'Preview' }))
  })

  it('puts the verdict under the sheet’s title, and describes the sheet by it', async () => {
    renderBar()

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    const sheet = await screen.findByRole('dialog', { name: 'Preview' })

    expect(sheet).toHaveAccessibleDescription(/^3 to check\W+4 adjusted\W+15 passing$/)
    expect(within(sheet).queryByText(/A document in this theme/)).not.toBeInTheDocument()
  })

  it('closes onto the report’s warnings from “to check”, not back onto the bar', async () => {
    const onReview = vi.fn<() => void>()
    renderBar(onReview)

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    const sheet = await screen.findByRole('dialog', { name: 'Preview' })
    await userEvent.click(within(sheet).getByRole('button', { name: '3 to check' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(onReview).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Preview' })).not.toHaveFocus()
  })
})
