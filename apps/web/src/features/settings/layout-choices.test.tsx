import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import type { LayoutSettings } from '../../lib/api/index.ts'
import { describeLayout, LAYOUT_AXES, LayoutChoices, layoutOptionLabel } from './layout-choices.tsx'

const INSTRUMENT: LayoutSettings = {
  comments: 'panel',
  history: 'timeline',
  navigation: 'tree',
  header: 'readout',
  rules: 'hairline',
}

function Harness({ initial = INSTRUMENT }: { readonly initial?: LayoutSettings }) {
  const [layout, setLayout] = useState(initial)
  return (
    <>
      <LayoutChoices layout={layout} onLayoutChange={setLayout} />
      <p data-testid="value">{describeLayout(layout)}</p>
    </>
  )
}

describe('the bounded set of layout variants', () => {
  it('offers every axis ADR-028 names, and nothing else', () => {
    expect(LAYOUT_AXES.map((axis) => axis.key)).toEqual([
      'navigation',
      'comments',
      'history',
      'header',
      'rules',
    ])
  })

  it.each(LAYOUT_AXES)('applies every option $key offers', (axis) => {
    for (const option of axis.options) {
      const applied = axis.apply(INSTRUMENT, option.value)
      expect(applied[axis.key]).toBe(option.value)
    }
  })

  it.each(LAYOUT_AXES)('refuses a value outside $key’s set, as the server does', (axis) => {
    // The server answers 400 for a value outside the bounded set rather than
    // warning; the client's equivalent is to leave the layout alone.
    expect(axis.apply(INSTRUMENT, 'carousel')).toEqual(INSTRUMENT)
  })

  it('names an option in words, and falls back to the raw value for an unknown one', () => {
    expect(layoutOptionLabel('navigation', 'tabs')).toBe('Collection tabs')
    expect(layoutOptionLabel('rules', 'carousel')).toBe('carousel')
  })

  it('describes a whole layout for a readout', () => {
    expect(describeLayout(INSTRUMENT)).toBe(
      'Navigation: Tree, Comments: Side panel, History: Timeline, Header: Status readout, Dividers: Hairlines',
    )
  })
})

describe('the layout radio groups', () => {
  it('marks the current option as checked in every group', () => {
    render(<Harness />)

    expect(screen.getByRole('radio', { name: /Tree/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Collection tabs/ })).not.toBeChecked()
  })

  it('changes one axis without disturbing the others', async () => {
    render(<Harness />)

    await userEvent.click(screen.getByRole('radio', { name: /Collection tabs/ }))

    expect(screen.getByTestId('value')).toHaveTextContent('Navigation: Collection tabs')
    expect(screen.getByTestId('value')).toHaveTextContent('Comments: Side panel')
  })

  it('disables every option when the organisation has locked layout', () => {
    render(<LayoutChoices layout={INSTRUMENT} disabled onLayoutChange={() => undefined} />)

    // Shown and refused, not hidden: the workspace still sees the arrangement
    // it has (docs/design/feedback.md).
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled()
    }
  })

  it('groups each axis under its own legend', () => {
    render(<Harness />)

    const navigation = screen.getByRole('group', { name: 'Navigation' })
    expect(within(navigation).getAllByRole('radio')).toHaveLength(2)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness />)

    await expectNoAccessibilityViolations(container)
  })
})
