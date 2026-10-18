import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { jsonResponse } from '../../lib/api/testing.ts'
import { SearchQueryField, type SearchQueryFieldHandle } from './search-query-field.tsx'

const PEOPLE = [
  { value: 'ada', label: 'Ada Lovelace' },
  { value: 'sam', label: 'Sam Taylor' },
]

const ROUTES = {
  'GET /api/search/suggestions': () => jsonResponse(200, { field: 'by', suggestions: PEOPLE }),
}

function Harness({
  initial = '',
  onSubmit,
}: {
  readonly initial?: string
  readonly onSubmit?: () => void
}) {
  const [value, setValue] = useState(initial)
  const field = useRef<SearchQueryFieldHandle | null>(null)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit?.()
      }}
    >
      <SearchQueryField
        ref={field}
        label="Search this organisation"
        value={value}
        onValueChange={setValue}
        workspaceId="ws-1"
      />
      <button type="button" onClick={() => field.current?.addFilter('by')}>
        Add by
      </button>
      <button type="button" onClick={() => field.current?.focus()}>
        Focus
      </button>
      <button type="submit">Search</button>
    </form>
  )
}

function view(props: Parameters<typeof Harness>[0] = {}) {
  return render(<Harness {...props} />, { wrapper: createHookWrapper(ROUTES) })
}

const field = (): HTMLInputElement => {
  const found = screen.getByRole('combobox', { name: 'Search this organisation' })
  if (!(found instanceof HTMLInputElement)) throw new Error('the query field is an input')
  return found
}

describe('SearchQueryField', () => {
  it('offers the filters a word begins, and choosing one writes it and offers its values next', async () => {
    const user = userEvent.setup()
    view()

    await user.type(field(), 'te')
    const option = await screen.findByRole('option', { name: 'Team' })
    expect(option).toHaveAccessibleDescription(/Anyone in a group or unit/)
    expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument()

    await user.click(option)

    expect(field()).toHaveValue('team:')
    expect(field()).toHaveFocus()
    expect(field().selectionStart).toBe(5)
    expect(field()).toHaveAttribute('aria-expanded', 'true')
  })

  it('suggests the values of the filter being typed, and says how many', async () => {
    const user = userEvent.setup()
    view()

    await user.type(field(), 'by:ad')

    expect(await screen.findByRole('option', { name: 'Ada Lovelace' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'By' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('2 suggestions')
    })
  })

  it('says it is searching, then that nothing was suggested', async () => {
    const user = userEvent.setup()
    render(<Harness />, {
      wrapper: createHookWrapper({
        'GET /api/search/suggestions': () => jsonResponse(200, { field: 'tag', suggestions: [] }),
      }),
    })

    await user.type(field(), 'tag:zz')

    expect(await screen.findByText('Searching…')).toBeInTheDocument()
    expect(await screen.findByText('Nothing suggested')).toBeInTheDocument()
  })

  it('chooses a value with the arrows and puts the caret after it', async () => {
    const user = userEvent.setup()
    view()

    await user.type(field(), 'by:ad')
    await screen.findByRole('option', { name: 'Ada Lovelace' })
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(field()).toHaveValue('by:sam ')
    expect(field().selectionStart).toBe(7)
    expect(field()).toHaveAttribute('aria-expanded', 'false')
  })

  it('leaves Enter to the form until the arrows have reached an option', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn<() => void>()
    view({ onSubmit })

    await user.type(field(), 'te')
    await screen.findByRole('option', { name: 'Team' })
    await user.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(field()).toHaveValue('te')
  })

  it('completes the token the caret is in, not the last one, and keeps the caret there', async () => {
    const user = userEvent.setup()
    view({ initial: 'by:a tag:x' })

    field().focus()
    field().setSelectionRange(4, 4)
    fireEvent(document, new Event('selectionchange'))
    await screen.findByRole('option', { name: 'Ada Lovelace' })
    await user.click(screen.getByRole('option', { name: 'Ada Lovelace' }))

    expect(field()).toHaveValue('by:ada tag:x')
    expect(field().selectionStart).toBe(6)
  })

  it('does not ask, or open, for a query nobody has put the caret in', () => {
    view({ initial: 'by:me' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('offers nothing for an ordinary word, or after a space', async () => {
    const user = userEvent.setup()
    view()

    await user.type(field(), 'failover')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.type(field(), ' ')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('starts a filter at the end for the page, after a space, with its values next', async () => {
    const user = userEvent.setup()
    view({ initial: 'failover' })

    await user.click(screen.getByRole('button', { name: 'Add by' }))

    expect(field()).toHaveValue('failover by:')
    expect(field()).toHaveFocus()
    expect(field().selectionStart).toBe(12)
    expect(await screen.findByRole('option', { name: 'Ada Lovelace' })).toBeInTheDocument()
  })

  it('does not add a second space, nor one to an empty query', async () => {
    const user = userEvent.setup()
    view({ initial: 'failover ' })
    await user.click(screen.getByRole('button', { name: 'Add by' }))
    expect(field()).toHaveValue('failover by:')
  })

  it('starts a filter in an empty query', async () => {
    const user = userEvent.setup()
    view()
    await user.click(screen.getByRole('button', { name: 'Add by' }))
    expect(field()).toHaveValue('by:')
  })

  it('can be focused by the page', async () => {
    const user = userEvent.setup()
    view()

    await user.click(screen.getByRole('button', { name: 'Focus' }))

    expect(field()).toHaveFocus()
  })

  it('ignores selection changes that are not in its own box', async () => {
    const user = userEvent.setup()
    view()
    await user.click(screen.getByRole('button', { name: 'Focus' }))
    field().blur()

    fireEvent(document, new Event('selectionchange'))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('has no accessibility violations with suggestions open', async () => {
    const user = userEvent.setup()
    const { container } = view()
    await user.type(field(), 'by:ad')
    await screen.findByRole('option', { name: 'Ada Lovelace' })

    await expectNoAccessibilityViolations(container)
  })
})
