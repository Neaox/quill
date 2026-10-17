import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { createFakeClock } from '../drafts/clock.ts'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { DocumentProperties, type DocumentPropertiesProps } from './document-properties.tsx'
import type { PeopleDirectory } from './people.ts'

const NOW = new Date(Date.UTC(2026, 9, 17, 9))
const CLOCK = createFakeClock(NOW.getTime())

const FRONT_MATTER: Record<string, unknown> = {
  id: 'doc-1',
  title: 'Reading surface tour',
  type: 'design',
  status: 'in-review',
  owners: ['ada@example.com', 'platform'],
  tags: ['design-system'],
  review: { interval: '90d' },
  somethingNobodyKnows: 'kept',
}

const PEOPLE = [
  { value: 'ada@example.com', name: 'Ada Lovelace', detail: 'ada@example.com' },
  { value: 'grace@example.com', name: 'Grace Hopper', detail: 'grace@example.com' },
]

const directory: PeopleDirectory = {
  nameOf: (value) => PEOPLE.find((person) => person.value === value)?.name,
  search: async (query) =>
    PEOPLE.filter((person) => person.name.toLowerCase().includes(query.toLowerCase())),
}

type HostProps = Partial<DocumentPropertiesProps> & {
  readonly initial?: Record<string, unknown>
  readonly onRecord?: (next: Record<string, unknown>) => void
}

/** The strip as the route mounts it: the record it is given is the record it changed. */
function Host({ initial = FRONT_MATTER, onRecord, ...props }: HostProps) {
  const [frontMatter, setFrontMatter] = useState(initial)
  return (
    <DocumentProperties
      frontMatter={frontMatter}
      headingTitle="Reading surface tour"
      people={directory}
      tagSuggestions={['ops', 'onboarding']}
      currentPerson={{ value: 'grace@example.com', name: 'Grace Hopper' }}
      clock={CLOCK}
      onChange={(next) => {
        setFrontMatter(next)
        onRecord?.(next)
      }}
      {...props}
    />
  )
}

function mount(props: HostProps = {}) {
  const user = userEvent.setup()
  const view = render(<Host {...props} />)
  return { user, ...view }
}

const line = () => screen.getByRole('group', { name: 'Document properties' })

describe('the properties line', () => {
  it('reads as the byline a reader sees, with every value its own control', async () => {
    const { container } = mount()
    expect(within(line()).getByRole('button', { name: /^Owners:/u })).toHaveTextContent(
      'Ada Lovelace',
    )
    expect(within(line()).getByRole('button', { name: /^Owners:/u })).toHaveTextContent('platform')
    expect(within(line()).getByRole('button', { name: 'Lifecycle: In review' })).toBeInTheDocument()
    expect(within(line()).getByRole('button', { name: 'Type: design' })).toBeInTheDocument()
    expect(within(line()).getByRole('button', { name: 'Tags: design-system' })).toBeInTheDocument()
    expect(within(line()).getByRole('button', { name: /^Review:/u })).toHaveTextContent(
      'Review every 90 days',
    )
    await expectNoAccessibilityViolations(container)
  })

  it('never shows an owner who is a person by their address', () => {
    mount()
    expect(line()).not.toHaveTextContent('ada@example.com')
  })

  it('changes the lifecycle from a menu of its words, keeping every other key in place', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ onRecord })
    await user.click(screen.getByRole('button', { name: 'Lifecycle: In review' }))
    await user.click(await screen.findByRole('menuitemradio', { name: /^Deprecated/u }))
    const next = onRecord.mock.lastCall?.[0]
    expect(next?.['status']).toBe('deprecated')
    expect(Object.keys(next ?? {})).toEqual(Object.keys(FRONT_MATTER))
    expect(screen.getByRole('button', { name: 'Lifecycle: Deprecated' })).toHaveFocus()
  })

  it('stamps a verification with the person signed in and today, never typed', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ onRecord })
    await user.click(screen.getByRole('button', { name: 'Lifecycle: In review' }))
    await user.click(await screen.findByRole('menuitemradio', { name: /^Verified/u }))
    const next = onRecord.mock.lastCall?.[0]
    expect(next?.['status']).toBe('verified')
    expect(next?.['verified']).toEqual({ by: 'grace@example.com', at: '2026-10-17' })
    // Verifying is a review, so the cycle starts again from today.
    expect(next?.['review']).toEqual({ interval: '90d', lastReviewed: '2026-10-17' })
    expect(onRecord).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: 'Lifecycle: Verified, by Grace Hopper, 17 Oct 2026' }),
    ).toHaveTextContent('Verifiedby Grace Hoppertoday')
  })

  it('says a verification whose review is overdue has lapsed, and keeps it in the file', () => {
    mount({
      initial: {
        id: 'doc-1',
        status: 'verified',
        verified: { by: 'ada@example.com', at: '2026-01-02' },
        review: { interval: '3m', lastReviewed: '2026-01-02' },
      },
    })
    expect(
      within(line()).getByRole('button', { name: 'Lifecycle: Verification lapsed' }),
    ).toBeInTheDocument()
    expect(line()).toHaveTextContent('Review overdue')
  })

  it('offers Verified disabled, with why, on a deprecated page', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ initial: { id: 'doc-1', status: 'deprecated' }, onRecord })
    await user.click(screen.getByRole('button', { name: 'Lifecycle: Deprecated' }))
    const verified = await screen.findByRole('menuitemradio', { name: /^Verified/u })
    expect(verified).toHaveAttribute('aria-disabled', 'true')
    expect(verified).toHaveTextContent('cannot be verified')
    await user.click(verified)
    expect(onRecord).not.toHaveBeenCalled()
  })

  it('chooses the page that replaces a deprecated one by searching for it', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const searchDocuments = vi.fn<
      () => Promise<readonly { id: string; title: string; context?: string }[]>
    >(async () => [
      { id: 'doc-1', title: 'Reading surface tour' },
      { id: 'doc-2', title: 'Reading surface, revised', context: 'Design' },
    ])
    const { user, container } = mount({
      initial: { id: 'doc-1', status: 'deprecated' },
      onRecord,
      searchDocuments,
    })
    await user.click(within(line()).getByRole('button', { name: 'Replaced by: Not set' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit replacement' })
    await user.type(within(dialog).getByRole('combobox', { name: 'Replaced by' }), 'reading')
    // The page itself is never offered as its own replacement.
    expect(
      await within(dialog).findByRole('option', { name: /Reading surface, revised/u }),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('option', { name: /^Reading surface tour/u })).toBeNull()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onRecord.mock.lastCall?.[0]).toEqual({
      id: 'doc-1',
      status: 'deprecated',
      supersededBy: 'doc-2',
    })
    await expectNoAccessibilityViolations(container)
  })

  it('shows a status from an earlier release read-only, and replaces it only when asked', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ initial: { id: 'doc-1', status: 'published' }, onRecord })
    expect(within(line()).queryByRole('button', { name: /^Lifecycle/u })).toBeNull()
    expect(line()).not.toHaveTextContent('Published')
    await user.click(screen.getByRole('button', { name: 'All properties' }))
    const all = screen.getByRole('region', { name: 'All properties' })
    expect(all).toHaveTextContent('published')
    expect(all).toHaveTextContent('Written by an earlier release')
    expect(onRecord).not.toHaveBeenCalled()
  })

  it('adds an owner from the people Quill knows, by name, with the keyboard', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ onRecord })
    await user.click(screen.getByRole('button', { name: /^Owners:/u }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit owners' })
    const field = within(dialog).getByRole('combobox', { name: 'Owners' })
    expect(field).toHaveFocus()
    await user.keyboard('gra')
    expect(await within(dialog).findByRole('option', { name: 'Grace Hopper' })).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onRecord.mock.lastCall?.[0]['owners']).toEqual([
      'ada@example.com',
      'platform',
      'grace@example.com',
    ])
    await user.keyboard('{Backspace}')
    expect(onRecord.mock.lastCall?.[0]['owners']).toEqual(['ada@example.com', 'platform'])
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /^Owners:/u })).toHaveFocus()
  })

  it('takes a team as an owner when it is typed, since not every owner is a person', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ onRecord })
    await user.click(screen.getByRole('button', { name: /^Owners:/u }))
    await screen.findByRole('dialog', { name: 'Edit owners' })
    await user.keyboard('sre-team{Enter}')
    expect(onRecord.mock.lastCall?.[0]['owners']).toEqual([
      'ada@example.com',
      'platform',
      'sre-team',
    ])
  })

  it('adds tags from suggestions, from typing, and from a pasted list', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ onRecord })
    await user.click(screen.getByRole('button', { name: 'Tags: design-system' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit tags' })
    await user.keyboard('on')
    expect(within(dialog).getByRole('option', { name: 'onboarding' })).toBeInTheDocument()
    await user.keyboard('{Enter}')
    await user.keyboard('runbooks,')
    await user.paste('alpha, beta')
    expect(onRecord.mock.lastCall?.[0]['tags']).toEqual([
      'design-system',
      'onboarding',
      'runbooks',
      'alpha',
      'beta',
    ])
  })

  it('writes the type once, when it is finished, not on every keystroke', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ onRecord })
    await user.click(screen.getByRole('button', { name: 'Type: design' }))
    const field = within(await screen.findByRole('dialog', { name: 'Edit type' })).getByRole(
      'textbox',
      { name: 'Type' },
    )
    await user.clear(field)
    await user.type(field, 'Runbook')
    expect(onRecord).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(onRecord).toHaveBeenCalledTimes(1)
    expect(onRecord.mock.lastCall?.[0]['type']).toBe('Runbook')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sets a review cycle from presets, and records a review today', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ onRecord })
    await user.click(screen.getByRole('button', { name: /^Review:/u }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit review' })
    await user.click(within(dialog).getByRole('radio', { name: '6 months' }))
    expect(onRecord.mock.lastCall?.[0]['review']).toEqual({ interval: '6m' })
    await user.click(within(dialog).getByRole('button', { name: 'Reviewed today' }))
    expect(onRecord.mock.lastCall?.[0]['review']).toEqual({
      interval: '6m',
      lastReviewed: '2026-10-17',
    })
    expect(within(dialog).getByText(/Next review due/u)).toHaveTextContent(
      'Next review due 15 Apr 2027',
    )
    await expectNoAccessibilityViolations(dialog)
  })

  it('takes a custom review interval, and says so when it is not one', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ onRecord })
    await user.click(screen.getByRole('button', { name: /^Review:/u }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit review' })
    const custom = within(dialog).getByRole('textbox', { name: 'Custom interval' })
    await user.clear(custom)
    await user.type(custom, 'soon{Enter}')
    expect(within(dialog).getByText('Use a count and a unit, such as 90d, 6m or 1y.')).toBeVisible()
    expect(onRecord).not.toHaveBeenCalled()
    await user.clear(custom)
    await user.type(custom, '2w{Enter}')
    expect(onRecord.mock.lastCall?.[0]['review']).toEqual({ interval: '2w' })
  })

  it('changes the last review date directly', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ onRecord })
    await user.click(screen.getByRole('button', { name: /^Review:/u }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit review' })
    const date = within(dialog).getByLabelText('Last reviewed')
    await user.type(date, '2026-09-01')
    expect(onRecord.mock.lastCall?.[0]['review']).toEqual({
      interval: '90d',
      lastReviewed: '2026-09-01',
    })
  })
})

describe('adding a property', () => {
  it('offers only what is not set, and opens its editor at once', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ initial: { id: 'doc-1' }, onRecord })
    expect(screen.queryByText('Nothing set yet')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add property' }))
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    expect(items).toEqual(['Owners', 'Lifecycle', 'Type', 'Tags', 'Review', 'Layout'])
    await user.click(screen.getByRole('menuitem', { name: 'Lifecycle' }))
    await user.click(await screen.findByRole('menuitemradio', { name: /^In review/u }))
    expect(onRecord.mock.lastCall?.[0]).toEqual({ id: 'doc-1', status: 'in-review' })
    expect(screen.getByRole('button', { name: 'Lifecycle: In review' })).toBeInTheDocument()
    // Two menus open and close in turn; generous, for a loaded machine.
  }, 15_000)

  it('opens a text editor for a new type and drops it unwritten if nothing is typed', async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ initial: { id: 'doc-1' }, onRecord })
    await user.click(screen.getByRole('button', { name: 'Add property' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Type' }))
    await screen.findByRole('dialog', { name: 'Edit type' })
    await user.keyboard('{Escape}')
    expect(onRecord).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add property' })).toHaveFocus()
  })

  it('offers nothing to add when everything is set', () => {
    mount({ initial: { ...FRONT_MATTER, layout: 'wide' } })
    expect(screen.queryByRole('button', { name: 'Add property' })).toBeNull()
  })
})

describe('everything else the front matter says', () => {
  it('lists every property, every question and every unknown key under All properties', async () => {
    const { user, container } = mount()
    const toggle = screen.getByRole('button', { name: 'All properties' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByRole('region', { name: 'All properties' })
    expect(within(panel).getByText('Reading surface tour')).toBeInTheDocument()
    expect(
      within(panel).getByText("The document's first heading is its title."),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Layout: Not set' })).toBeInTheDocument()
    const other = within(panel).getByRole('group', { name: 'Other fields' })
    expect(other).toHaveTextContent('somethingNobodyKnows')
    expect(other).toHaveTextContent('kept')
    await expectNoAccessibilityViolations(container)
  })

  it('edits the front matter as YAML for whoever wants to, refusing what would break it', async () => {
    const onSourceChange = vi.fn<(source: string) => void>()
    const { user } = mount({ source: 'id: doc-1\ntype: design # keep\n', onSourceChange })
    await user.click(screen.getByRole('button', { name: 'All properties' }))
    await user.click(screen.getByRole('button', { name: 'Edit as YAML' }))
    const yaml = screen.getByRole('textbox', { name: 'Front matter' })
    expect(yaml).toHaveValue('id: doc-1\ntype: design # keep\n')

    await user.clear(yaml)
    await user.type(yaml, 'id: "unterminated')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('This is not valid YAML')
    expect(onSourceChange).not.toHaveBeenCalled()

    await user.clear(yaml)
    await user.type(yaml, 'id: doc-2')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The id cannot change')

    await user.clear(yaml)
    await user.type(yaml, 'id: doc-1{Enter}type: runbook # keep')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onSourceChange).toHaveBeenCalledWith('id: doc-1\ntype: runbook # keep')
    expect(screen.queryByRole('textbox', { name: 'Front matter' })).toBeNull()
  })

  it('does not offer YAML editing where nothing could apply it', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'All properties' }))
    expect(screen.queryByRole('button', { name: 'Edit as YAML' })).toBeNull()
  })
})

describe('what needs attention', () => {
  it('says what is wrong with a value while the list is closed, and opens it on request', async () => {
    const { user } = mount({ initial: { id: 'doc-1', layout: 'enormous' } })
    const issue = screen.getByRole('button', { name: /is not a layout/u })
    expect(issue).toHaveTextContent('Layout: “enormous” is not a layout')
    // The list opens by itself, because the value has to be fixed somewhere.
    expect(screen.getByRole('button', { name: 'All properties' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'All properties' }))
    await user.click(issue)
    expect(screen.getByRole('button', { name: 'All properties' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  const TEMPLATE: Record<string, unknown> = {
    id: 'template-1',
    template: {
      name: 'Decision',
      version: 1,
      questions: [
        { id: 'outcome', label: 'Outcome', type: 'choice', options: ['Accepted', 'Rejected'] },
        { id: 'decidedOn', label: 'Decided on', type: 'date', optional: true },
        { id: 'summary', label: 'Summary', type: 'text', optional: true },
        { id: 'driver', label: 'Driver', type: 'user', optional: true },
      ],
    },
  }

  it("puts a template's unanswered questions in front, and answers them in place", async () => {
    const onRecord = vi.fn<(next: Record<string, unknown>) => void>()
    const { user } = mount({ initial: TEMPLATE, onRecord })
    const nudge = screen.getByRole('button', { name: '1 question unanswered' })
    expect(nudge).toBeInTheDocument()
    const questions = screen.getByRole('group', { name: 'Template questions' })
    await user.click(within(questions).getByRole('button', { name: 'Outcome: Not answered' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Accepted' }))
    expect(onRecord.mock.lastCall?.[0]['outcome']).toBe('Accepted')
    expect(screen.queryByRole('button', { name: /unanswered/u })).toBeNull()

    await user.click(within(questions).getByRole('button', { name: 'Decided on: Not answered' }))
    const date = within(
      await screen.findByRole('dialog', { name: 'Edit decided on' }),
    ).getByLabelText('Decided on')
    await user.type(date, '2026-10-01')
    expect(onRecord.mock.lastCall?.[0]['decidedOn']).toBe('2026-10-01')
    await user.keyboard('{Escape}')

    await user.click(within(questions).getByRole('button', { name: 'Summary: Not answered' }))
    await user.keyboard('Ship it{Enter}')
    expect(onRecord.mock.lastCall?.[0]['summary']).toBe('Ship it')

    await user.click(within(questions).getByRole('button', { name: 'Driver: Not answered' }))
    await screen.findByRole('dialog', { name: 'Edit driver' })
    await user.keyboard('ada')
    await screen.findByRole('option', { name: 'Ada Lovelace' })
    await user.keyboard('{Enter}')
    expect(onRecord.mock.lastCall?.[0]['driver']).toEqual(['ada@example.com'])
  })

  it('opens the questions from the nudge', async () => {
    const { user } = mount({ initial: TEMPLATE, defaultOpen: false })
    await user.click(screen.getByRole('button', { name: 'All properties' }))
    expect(screen.queryByRole('group', { name: 'Template questions' })).toBeNull()
    await user.click(screen.getByRole('button', { name: '1 question unanswered' }))
    expect(screen.getByRole('group', { name: 'Template questions' })).toBeVisible()
  })
})

describe('using it', () => {
  it('passes Ctrl+Z and Ctrl+Shift+Z or Ctrl+Y to the document history, outside text fields', async () => {
    const onUndo = vi.fn<() => void>()
    const onRedo = vi.fn<() => void>()
    const { user } = mount({ onUndo, onRedo })
    screen.getByRole('button', { name: 'Lifecycle: In review' }).focus()
    await user.keyboard('{Control>}z{/Control}')
    expect(onUndo).toHaveBeenCalledTimes(1)
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    await user.keyboard('{Meta>}y{/Meta}')
    expect(onRedo).toHaveBeenCalledTimes(2)

    // In a text field, the field's own undo comes first.
    await user.click(screen.getByRole('button', { name: 'Type: design' }))
    await screen.findByRole('dialog', { name: 'Edit type' })
    await user.keyboard('{Control>}z{/Control}')
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('shows the values, and why they cannot be changed, when the document cannot be edited', async () => {
    const { container } = mount({ editable: false, readOnlyReason: 'Grace Hopper is editing' })
    expect(within(line()).queryByRole('button', { name: /Lifecycle/u })).toBeNull()
    expect(line()).toHaveTextContent('In review')
    expect(screen.queryByRole('button', { name: 'Add property' })).toBeNull()
    expect(screen.getByText('Grace Hopper is editing')).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('follows a record that changes under it, as an undo does', () => {
    const { rerender } = render(
      <DocumentProperties frontMatter={FRONT_MATTER} clock={CLOCK} onChange={() => {}} />,
    )
    act(() => {
      rerender(
        <DocumentProperties
          frontMatter={{ ...FRONT_MATTER, status: 'verified' }}
          clock={CLOCK}
          onChange={() => {}}
        />,
      )
    })
    expect(screen.getByRole('button', { name: 'Lifecycle: Verified' })).toBeInTheDocument()
  })

  it('shows an owner as written when there is no directory to name them', () => {
    render(<DocumentProperties frontMatter={FRONT_MATTER} clock={CLOCK} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /^Owners:/u })).toHaveTextContent('ada@example.com')
  })
})
