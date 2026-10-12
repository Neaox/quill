import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { ACCENT_SWATCHES, MAX_LABELS, generateTheme, instrument } from '@quill/theme'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { LabelsEditor, type LabelSeeds } from './labels-editor.tsx'

function Harness({
  initial,
  emoji,
}: {
  readonly initial?: LabelSeeds | undefined
  readonly emoji?: readonly string[]
}) {
  const [labels, setLabels] = useState<LabelSeeds | undefined>(initial)
  const generated = generateTheme({ ...instrument, ...(labels === undefined ? {} : { labels }) })
  return (
    <>
      <LabelsEditor
        labels={labels}
        generated={generated.labels}
        light={generated.light}
        dark={generated.dark}
        {...(emoji === undefined
          ? {}
          : {
              emoji,
              emojiSources: new Map([
                ['support', { src: '/api/emoji/support.0123456789abcdef.svg' }],
              ]),
            })}
        onLabelsChange={setLabels}
      />
      <output data-testid="labels">{JSON.stringify(labels ?? null)}</output>
    </>
  )
}

const saved = (): unknown => JSON.parse(screen.getByTestId('labels').textContent ?? 'null')

const SUPPORT = { name: 'support', title: 'Support', hue: 5, chroma: 0.15 }

describe('LabelsEditor (ADR-037)', () => {
  it('adds a label by name and title, starting on a swatch', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText('Name'), 'Support')
    await user.type(screen.getByLabelText('Title'), 'Support')
    await user.click(screen.getByRole('button', { name: 'Add label' }))

    const [first] = ACCENT_SWATCHES
    expect(saved()).toEqual([
      { name: 'support', title: 'Support', hue: first.hue, chroma: first.chroma },
    ])
    expect(screen.getByText(':support[Support]')).toBeInTheDocument()
  })

  it('previews the pill a reader sees, in both schemes', () => {
    render(<Harness initial={[SUPPORT]} />)
    const preview = screen.getByRole('group', { name: 'Preview of Support' })
    expect(within(preview).getByText('Light')).toBeInTheDocument()
    expect(within(preview).getByText('Dark')).toBeInTheDocument()
    expect(within(preview).getAllByText('Support')).toHaveLength(2)
  })

  it('says why a name cannot be used, and will not add it', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[SUPPORT]} />)
    const name = screen.getByLabelText('Name')
    const add = screen.getByRole('button', { name: 'Add label' })

    await user.type(name, 'badge')
    expect(name).toHaveAccessibleDescription(expect.stringContaining('already a built-in name'))
    expect(add).toBeDisabled()

    await user.clear(name)
    await user.type(name, 'support')
    expect(name).toHaveAccessibleDescription(expect.stringContaining('already a label'))
    expect(add).toBeDisabled()

    await user.clear(name)
    await user.type(name, '9lives')
    expect(name).toHaveAccessibleDescription(expect.stringContaining('lower-case letter'))
  })

  it('titles a label by its name when no title is given', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByLabelText('Name'), 'billing')
    await user.click(screen.getByRole('button', { name: 'Add label' }))
    expect(saved()).toEqual([expect.objectContaining({ name: 'billing', title: 'billing' })])
  })

  it('renames the title, recolours from a swatch, and removes the last label entirely', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[SUPPORT]} />)
    const item = screen.getByRole('listitem')

    const title = within(item).getByLabelText('Title')
    await user.clear(title)
    expect(title).toHaveAccessibleDescription(expect.stringContaining('needs a title'))
    await user.type(title, 'Support stays')
    expect(saved()).toEqual([{ ...SUPPORT, title: 'Support stays' }])

    const ocean = ACCENT_SWATCHES.find((swatch) => swatch.id === 'ocean')
    await user.click(within(item).getByRole('radio', { name: 'Ocean' }))
    expect(saved()).toEqual([
      { ...SUPPORT, title: 'Support stays', hue: ocean?.hue, chroma: ocean?.chroma },
    ])

    await user.click(screen.getByRole('button', { name: 'Remove the label Support stays' }))
    expect(saved()).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('stops offering to add once the theme holds as many as it may', () => {
    const many = Array.from({ length: MAX_LABELS }, (_, index) => ({
      name: `l${index}`,
      title: `L${index}`,
      hue: index * 10,
    }))
    render(<Harness initial={many} />)
    expect(screen.queryByRole('button', { name: 'Add label' })).toBeNull()
    expect(screen.getByText(/at most 24 labels/u)).toBeInTheDocument()
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<Harness initial={[SUPPORT]} />)
    await expectNoAccessibilityViolations(container)
  })

  it('lets a label lead with one of the organisation’s emoji (ADR-038)', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[SUPPORT]} emoji={['support', 'headset']} />)
    // The preview pill leads with the emoji of the label's own name.
    const preview = screen.getByRole('group', { name: 'Preview of Support' })
    expect(preview.querySelectorAll('img')).toHaveLength(2)
    const select = screen.getByLabelText('Emoji')
    expect(
      within(select).getByRole('option', { name: ':support: (same name)' }),
    ).toBeInTheDocument()

    await user.selectOptions(select, 'headset')
    expect(saved()).toEqual([{ ...SUPPORT, emoji: 'headset' }])
    await user.selectOptions(select, '')
    expect(saved()).toEqual([SUPPORT])
  })

  it('offers none when no emoji shares the label’s name', () => {
    render(<Harness initial={[SUPPORT]} emoji={['headset']} />)
    expect(
      within(screen.getByLabelText('Emoji')).getByRole('option', { name: 'None' }),
    ).toBeInTheDocument()
  })
})
