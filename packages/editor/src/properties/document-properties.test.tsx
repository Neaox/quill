import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { DocumentProperties } from './document-properties.tsx'

const FRONT_MATTER: Record<string, unknown> = {
  id: 'doc-1',
  title: 'Reading surface tour',
  type: 'design',
  status: 'published',
  owners: ['platform@example.com'],
  tags: ['design-system'],
  review: { interval: '90d' },
  somethingNobodyKnows: 'kept',
}

/** The strip as the route mounts it: the record it is given is the record it changed. */
function Host({
  initial = FRONT_MATTER,
  onChange,
}: {
  readonly initial?: Record<string, unknown>
  onChange?(next: Record<string, unknown>): void
}) {
  const [frontMatter, setFrontMatter] = useState(initial)
  return (
    <DocumentProperties
      frontMatter={frontMatter}
      headingTitle="Reading surface tour"
      onChange={(next) => {
        setFrontMatter(next)
        onChange?.(next)
      }}
    />
  )
}

function open(props: Parameters<typeof Host>[0] = {}) {
  const user = userEvent.setup()
  const view = render(<Host {...props} />)
  return { user, ...view }
}

async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Properties' }))
}

describe('the properties strip', () => {
  it('opens closed, as one line of facts about the document', () => {
    open()
    const toggle = screen.getByRole('button', { name: 'Properties' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const summary = within(screen.getByRole('list', { name: 'Summary' }))
    expect(summary.getByText('Published')).toBeVisible()
    expect(summary.getByText('design')).toBeVisible()
    expect(summary.getByText('platform@example.com')).toBeVisible()
    expect(summary.getByText('#design-system')).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Type' })).not.toBeInTheDocument()
  })

  it('says so rather than showing an empty line when nothing is set', () => {
    open({ initial: { id: 'doc-1' } })
    expect(screen.getByText('Nothing set yet')).toBeVisible()
  })

  it('opens to the fields those facts come from, and closes again', async () => {
    const { user } = open()
    await expand(user)
    const toggle = screen.getByRole('button', { name: 'Properties' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'Type' })).toHaveValue('design')
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('published')
    expect(screen.getByRole('textbox', { name: 'Owners' })).toHaveValue('platform@example.com')
    expect(screen.getByRole('textbox', { name: 'Review every' })).toHaveValue('90d')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Type' })).not.toBeInTheDocument()
  })

  it('shows the title, and says where it is written instead of offering a second one', async () => {
    const { user } = open()
    await expand(user)
    expect(screen.queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument()
    expect(screen.getByText('Reading surface tour')).toBeVisible()
    expect(screen.getByText("The document's first heading is its title.")).toBeVisible()
  })

  it('writes a text field back as it is typed', async () => {
    const onChange = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = open({ onChange })
    await expand(user)
    await user.clear(screen.getByRole('textbox', { name: 'Type' }))
    await user.type(screen.getByRole('textbox', { name: 'Type' }), 'runbook')
    expect(screen.getByRole('textbox', { name: 'Type' })).toHaveValue('runbook')
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'runbook' })
  })

  it('writes a chosen value back', async () => {
    const onChange = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = open({ onChange })
    await expand(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'draft')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'draft' }))
  })

  it('writes a list field back as a list', async () => {
    const onChange = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = open({ onChange })
    await expand(user)
    await user.type(screen.getByRole('textbox', { name: 'Tags' }), ', showcase')
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      tags: ['design-system', 'showcase'],
    })
  })

  it('writes a nested field back without disturbing the rest of its branch', async () => {
    const onChange = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = open({
      initial: { ...FRONT_MATTER, review: { interval: '90d', lastReviewed: '2026-01-05' } },
      onChange,
    })
    await expand(user)
    await user.clear(screen.getByRole('textbox', { name: 'Review every' }))
    await user.type(screen.getByRole('textbox', { name: 'Review every' }), '1y')
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      review: { interval: '1y', lastReviewed: '2026-01-05' },
    })
  })

  it('shows no "Other fields" group when every key the document carries has its own field', async () => {
    const { user } = open({ initial: { type: 'design' } })
    await expand(user)
    expect(screen.queryByRole('group', { name: 'Other fields' })).not.toBeInTheDocument()
  })

  it('says the title is not set rather than showing a blank readout', async () => {
    const user = userEvent.setup()
    render(<DocumentProperties frontMatter={{ type: 'design' }} onChange={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'Properties' }))
    const title = screen.getByText('Title')
    const dl = title.closest('dl')
    if (dl === null) throw new Error('The title readout did not render as a description list.')
    expect(within(dl).getByText('Not set')).toBeVisible()
  })

  it('asks a date question with a date input (ADR-029)', async () => {
    const { user } = open({
      initial: {
        id: 'template-1',
        template: {
          name: 'Architecture decision record',
          version: 3,
          questions: [{ id: 'decidedOn', label: 'Decided on', type: 'date' }],
        },
        decidedOn: '2026-01-05',
      },
    })
    await expand(user)
    const field = screen.getByLabelText('Decided on')
    expect(field).toHaveAttribute('type', 'date')
    expect(field).toHaveValue('2026-01-05')
  })

  it('shows a key it has no control for rather than hiding it (rule 7)', async () => {
    const { user } = open()
    await expand(user)
    expect(screen.getByRole('group', { name: 'Other fields' })).toBeVisible()
    expect(screen.getByText('somethingNobodyKnows')).toBeVisible()
    expect(screen.getByText('kept')).toBeVisible()
    expect(screen.getByText('doc-1')).toBeVisible()
  })

  it("asks a template's questions, with the answers the document carries (ADR-029)", async () => {
    const { user } = open({
      initial: {
        id: 'template-1',
        template: {
          name: 'Architecture decision record',
          version: 3,
          questions: [
            {
              id: 'touchesAuth',
              label: 'Touches auth, data access or secrets',
              type: 'boolean',
            },
          ],
        },
        touchesAuth: true,
      },
    })
    await expand(user)
    expect(screen.getByRole('group', { name: 'Template questions' })).toBeVisible()
    expect(
      screen.getByRole('combobox', { name: 'Touches auth, data access or secrets' }),
    ).toHaveValue('true')
  })

  it('offers nothing to change when the document cannot be edited', async () => {
    const { user } = open()
    render(
      <DocumentProperties frontMatter={FRONT_MATTER} editable={false} onChange={() => undefined} />,
    )
    const strips = screen.getAllByRole('region', { name: 'Document properties' })
    const readOnly = strips.at(-1)
    if (readOnly === undefined) throw new Error('The read-only strip did not render.')
    await user.click(within(readOnly).getByRole('button', { name: 'Properties' }))
    expect(within(readOnly).getByRole('textbox', { name: 'Type' })).toBeDisabled()
    expect(within(readOnly).getByRole('combobox', { name: 'Status' })).toBeDisabled()
  })

  it('renders the strip without an accessibility violation, open and closed', async () => {
    const { container, user } = open({ initial: { ...FRONT_MATTER, layout: 'wide' } })
    await expectNoAccessibilityViolations(container)
    await expand(user)
    await expectNoAccessibilityViolations(container)
  })
})
