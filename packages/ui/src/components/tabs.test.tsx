import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { Tab, TabList, TabPanel, Tabs } from './tabs.tsx'

interface Options {
  readonly value?: string
  readonly onValueChange?: (value: string) => void
  readonly disableChanges?: boolean
}

function renderTabs({ value, onValueChange, disableChanges = false }: Options = {}) {
  return render(
    <Tabs
      defaultValue="content"
      {...(value === undefined ? {} : { value })}
      {...(onValueChange === undefined ? {} : { onValueChange })}
      className="max-w-lg"
    >
      <TabList label="Document view" className="px-1">
        <Tab value="content">Content</Tab>
        <Tab value="history">History</Tab>
        <Tab value="changes" disabled={disableChanges}>
          Changes
        </Tab>
      </TabList>
      <TabPanel value="content" className="pt-1">
        The document body.
      </TabPanel>
      <TabPanel value="history">Every published revision.</TabPanel>
      <TabPanel value="changes">A diff against the previous revision.</TabPanel>
    </Tabs>,
  )
}

describe('Tabs', () => {
  it('exposes a labelled tab list with one selected tab', async () => {
    const { container } = renderTabs()

    expect(screen.getByRole('tablist', { name: 'Document view' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Content', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('The document body.')
    await expectNoAccessibilityViolations(container)
  })

  it('shows only the selected panel', () => {
    renderTabs()

    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })

  it('selects a tab with the pointer', async () => {
    renderTabs()

    await userEvent.click(screen.getByRole('tab', { name: 'History' }))

    expect(screen.getByRole('tab', { name: 'History', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Every published revision.')
  })

  it('moves between tabs with the arrow keys', async () => {
    renderTabs()

    await userEvent.tab()
    expect(screen.getByRole('tab', { name: 'Content' })).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'History', selected: true })).toHaveFocus()

    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Content', selected: true })).toHaveFocus()
  })

  it('keeps unselected tabs out of the tab sequence', async () => {
    renderTabs()

    await userEvent.tab()
    expect(screen.getByRole('tab', { name: 'Content' })).toHaveFocus()

    await userEvent.tab()
    expect(screen.getByRole('tabpanel')).toHaveFocus()
  })

  it('skips a disabled tab', async () => {
    renderTabs({ disableChanges: true })

    expect(screen.getByRole('tab', { name: 'Changes' })).toBeDisabled()

    await userEvent.click(screen.getByRole('tab', { name: 'Changes' }))
    expect(screen.getByRole('tab', { name: 'Content', selected: true })).toBeInTheDocument()
  })

  it('reports selection to a controlling caller', async () => {
    const onValueChange = vi.fn<(value: string) => void>()
    renderTabs({ value: 'content', onValueChange })

    await userEvent.click(screen.getByRole('tab', { name: 'History' }))

    expect(onValueChange).toHaveBeenCalledWith('history')
    // Still showing what the caller asked for, not what was clicked.
    expect(screen.getByRole('tab', { name: 'Content', selected: true })).toBeInTheDocument()
  })
})
