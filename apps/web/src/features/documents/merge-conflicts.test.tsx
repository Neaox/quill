import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { mergeDocuments, parseMarkdown, resolveMerge, stringifyMdast } from '@quill/markdown'
import type { ConflictResolution } from '@quill/markdown'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { MergeConflicts } from './merge-conflicts.tsx'

const merge = mergeDocuments(
  parseMarkdown('# Runbook\n\nMove traffic east.\n\nCheck the dashboards.\n\nPage the on-call.\n'),
  parseMarkdown('# Runbook\n\nMove traffic west.\n\nCheck the dashboards.\n\nPage the lead.\n'),
  parseMarkdown('# Runbook\n\nMove traffic north.\n\nCheck the dashboards.\n'),
)

function renderConflicts() {
  const onResolve = vi.fn<(resolutions: readonly ConflictResolution[]) => void>()
  const onKeepMine = vi.fn<() => void>()
  const view = render(
    <MergeConflicts merge={merge} otherName="Sam" onResolve={onResolve} onKeepMine={onKeepMine} />,
  )
  return { ...view, onResolve, onKeepMine, user: userEvent.setup() }
}

/** A side of a conflict, found by its caption. */
const side = (scope: HTMLElement, caption: string): HTMLElement => {
  const figure = within(scope).getByText(caption).closest('figure')
  if (figure === null) throw new Error(`No figure captioned ${caption}`)
  return figure
}

const resolved = (resolutions: readonly ConflictResolution[]) => {
  const tree = resolveMerge(merge, resolutions)
  return tree === undefined ? undefined : stringifyMdast(tree)
}

describe('the conflict view', () => {
  it('shows only the places in conflict, each with both versions and its context', () => {
    renderConflicts()
    expect(
      screen.getByRole('heading', { name: 'Your offline changes overlap with Sam’s' }),
    ).toBeVisible()
    const first = screen.getByRole('article', { name: 'Change 1 of 2' })
    expect(side(first, 'Sam’s version')).toHaveTextContent('Move traffic eastnorth.')
    expect(side(first, 'Your version').querySelector('del')).toHaveTextContent('east')
    // Just the block before and after, never the whole document twice.
    expect(within(first).getByText(/Runbook/)).toBeVisible()
    expect(within(first).getByText(/Check the dashboards/)).toBeVisible()
    // What each side changed is marked by element, not colour alone.
    expect(side(first, 'Your version').querySelector('ins')).toHaveTextContent('west')
    const second = screen.getByRole('article', { name: 'Change 2 of 2' })
    expect(within(second).getByText('Removed in this version.')).toBeVisible()
  })

  it('saves nothing until every place has a choice, then saves those choices', async () => {
    const { user, onResolve } = renderConflicts()
    const save = screen.getByRole('button', { name: 'Save the merged draft' })
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription('Choose what to keep for every change to save.')

    const first = screen.getByRole('group', { name: 'What to keep for change 1' })
    await user.click(within(first).getByRole('radio', { name: 'Keep both' }))
    expect(save).toBeDisabled()
    const second = screen.getByRole('group', { name: 'What to keep for change 2' })
    await user.click(within(second).getByRole('radio', { name: 'Keep theirs' }))
    await user.click(save)

    expect(onResolve).toHaveBeenCalledTimes(1)
    const [resolutions] = onResolve.mock.calls[0] ?? [[]]
    expect(resolved(resolutions)).toBe(
      '# Runbook\n\nMove traffic north.\n\nMove traffic west.\n\nCheck the dashboards.\n',
    )
  })

  it('is chosen from the keyboard: arrow keys move between the choices', async () => {
    const { user, onResolve } = renderConflicts()
    const first = screen.getByRole('group', { name: 'What to keep for change 1' })
    await user.click(within(first).getByRole('radio', { name: 'Keep mine' }))
    await user.keyboard('{ArrowRight}')
    expect(within(first).getByRole('radio', { name: 'Keep theirs' })).toBeChecked()
    await user.tab()
    await user.keyboard('{ArrowRight}')
    const second = screen.getByRole('group', { name: 'What to keep for change 2' })
    expect(within(second).getByRole('radio', { name: 'Keep theirs' })).toBeChecked()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onResolve).toHaveBeenCalledTimes(1)
  })

  it('takes an edit in Markdown, starting from mine', async () => {
    const { user, onResolve } = renderConflicts()
    const first = screen.getByRole('group', { name: 'What to keep for change 1' })
    await user.click(within(first).getByRole('radio', { name: 'Edit' }))
    const editor = screen.getByRole('textbox', { name: 'Your edit, in Markdown' })
    expect(editor).toHaveValue('Move traffic west.\n')
    await user.clear(editor)
    await user.type(editor, 'Move traffic west, then north.')
    const second = screen.getByRole('group', { name: 'What to keep for change 2' })
    await user.click(within(second).getByRole('radio', { name: 'Keep mine' }))
    await user.click(screen.getByRole('button', { name: 'Save the merged draft' }))
    const [resolutions] = onResolve.mock.calls[0] ?? [[]]
    expect(resolved(resolutions)).toBe(
      '# Runbook\n\nMove traffic west, then north.\n\nCheck the dashboards.\n\nPage the lead.\n',
    )
  })

  it('keeps all of mine only after a confirmation that says what is lost', async () => {
    const { user, onKeepMine } = renderConflicts()
    await user.click(screen.getByRole('button', { name: 'Keep all of mine…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Keep your version everywhere?' })
    expect(dialog).toHaveTextContent('Sam’s changes to the 2 places shown above will be lost')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onKeepMine).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Keep all of mine…' }))
    await user.click(await screen.findByRole('button', { name: 'Replace Sam’s changes' }))
    expect(onKeepMine).toHaveBeenCalledTimes(1)
  })

  it('words a single conflict in the singular', async () => {
    const one = mergeDocuments(
      parseMarkdown('A red apple.\n'),
      parseMarkdown('A green apple.\n'),
      parseMarkdown('A yellow apple.\n'),
    )
    const user = userEvent.setup()
    render(
      <MergeConflicts merge={one} otherName="Sam" onResolve={() => {}} onKeepMine={() => {}} />,
    )
    expect(screen.getByText(/One place changed on both sides/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Keep all of mine…' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Sam’s change to the place shown above will be lost',
    )
  })

  it('has no axe violations', async () => {
    const { container } = renderConflicts()
    await expectNoAccessibilityViolations(container)
  })
})
