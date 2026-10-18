import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { createHookWrapper } from '../../../lib/api/hook-wrapper.tsx'
import type { PublicMenu, PublicMenuTarget } from '../../../lib/api/index.ts'
import { searchHitFixture } from '../../../lib/api/search-fixtures.ts'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../../lib/api/testing.ts'
import { PublicMenuEditor } from './public-menu-editor.tsx'

const OVERVIEW = '0192f0aa-0000-7000-8000-000000000001'
const SYNC = '0192f0aa-0000-7000-8000-000000000002'
const GONE = '0192f0aa-0000-7000-8000-000000000003'
const GUIDES = '0192f0aa-0000-7000-8000-000000000004'

const TARGETS: readonly PublicMenuTarget[] = [
  {
    kind: 'document',
    id: OVERVIEW,
    status: 'public',
    title: 'Overview',
    workspaceName: 'Engineering',
    collectionName: 'Guides',
    href: '/s/guides/overview',
  },
  {
    kind: 'document',
    id: SYNC,
    status: 'not-public',
    title: 'The sync map',
    workspaceName: 'Engineering',
    collectionName: 'Architecture',
    href: null,
  },
  {
    kind: 'document',
    id: GONE,
    status: 'missing',
    title: null,
    workspaceName: null,
    collectionName: null,
    href: null,
  },
  {
    kind: 'collection',
    id: GUIDES,
    status: 'public',
    title: 'Guides',
    workspaceName: 'Engineering',
    collectionName: null,
    href: '/s/guides',
  },
]

/** Answers for exactly the ids asked about, as the server does. */
const targets = (request: Request): Response => {
  const query = new URL(request.url).searchParams
  const asked = new Set([...query.getAll('document'), ...query.getAll('collection')])
  return jsonResponse(200, { targets: TARGETS.filter((target) => asked.has(target.id)) })
}

const searchHit = (documentId: string, title: string) =>
  searchHitFixture(title, {
    documentId,
    shortId: 'k000000001',
    slug: title.toLowerCase(),
    path: `${title}.md`,
    workspaceId: 'w-1',
    breadcrumb: ['Engineering', 'Architecture'],
    snippet: { text: title, ranges: [] },
  })

function routes(extra: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/settings/organisation/public-menu/targets': targets,
    'GET /api/search': (request) => {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      const hits = q.startsWith('sync') ? [searchHit(SYNC, 'The sync map')] : []
      return jsonResponse(200, { query: q, current: hits, elsewhere: [] })
    },
    'GET /api/settings/organisation/public-menu/collections': (request) => {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      return jsonResponse(200, {
        collections: 'guides'.includes(q.toLowerCase())
          ? [{ id: GUIDES, name: 'Guides', workspaceName: 'Engineering', isPublic: true }]
          : [],
      })
    },
    ...extra,
  }
}

const MENU: PublicMenu = [
  { kind: 'document', id: OVERVIEW },
  {
    kind: 'group',
    label: 'Reference',
    items: [
      { kind: 'document', id: SYNC, label: 'Sync' },
      { kind: 'url', href: 'https://status.example.com', label: 'Status' },
    ],
  },
]

/** The editor with its draft held, as the settings page holds it. */
function Harness({
  initial,
  onChange,
}: {
  initial: PublicMenu
  onChange: (menu: PublicMenu) => void
}) {
  const [menu, setMenu] = useState(initial)
  return (
    <PublicMenuEditor
      menu={menu}
      siteName="Acme"
      onMenuChange={(next) => {
        setMenu(next)
        onChange(next)
      }}
    />
  )
}

function renderEditor(initial: PublicMenu = MENU, extra: FakeRoutes = {}) {
  const onChange = vi.fn<(menu: PublicMenu) => void>()
  const view = render(<Harness initial={initial} onChange={onChange} />, {
    wrapper: createHookWrapper(routes(extra)),
  })
  const latest = (): PublicMenu => onChange.mock.lastCall?.[0] ?? initial
  return { ...view, onChange, latest }
}

const items = () => screen.getByRole('list', { name: 'Menu items' })

/** A row's line: the button that names it and opens it. */
const row = (name: string) => screen.getByRole('button', { name, expanded: false })

/** Waits for the targets to be looked up, which is when the rows have their names. */
const ready = () => screen.findByRole('button', { name: 'Overview' })

describe('the public menu editor', () => {
  it('starts empty with a sentence and the two ways to begin', () => {
    renderEditor([])
    expect(screen.getByText(/No menu yet/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add a link' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add a dropdown' })).toBeEnabled()
  })

  it('lists each item as one compact row: its name, what it points at, and a word only when something is wrong', async () => {
    renderEditor()
    await ready()
    expect(row('Overview')).toHaveAccessibleDescription('Guides')
    expect(row('Sync')).toHaveAccessibleDescription(/^The sync map · Architecture/u)
    expect(row('Reference')).toHaveAccessibleDescription('2 links')
    expect(row('Status')).toHaveAccessibleDescription('status.example.com')
    // Only the link that the header will leave out says anything.
    expect(within(row('Sync')).getByText('Not public')).toBeVisible()
    expect(within(row('Overview')).queryByText('Not public')).toBeNull()
    // No fields until a row is opened.
    expect(screen.queryByLabelText('Label')).toBeNull()
  })

  it('opens one row at a time, by click or Enter, and closes it on Escape with focus back on the row', async () => {
    const user = userEvent.setup()
    renderEditor()
    await ready()

    await user.click(row('Overview'))
    expect(screen.getByRole('button', { name: 'Overview', expanded: true })).toBeVisible()
    expect(screen.getByLabelText('Label')).toHaveAccessibleDescription(
      'Follows the document’s title',
    )

    row('Status').focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Status', expanded: true })).toBeVisible()
    expect(row('Overview')).toBeVisible()
    expect(screen.getAllByLabelText('Label')).toHaveLength(1)

    await user.click(screen.getByLabelText('Address'))
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Address')).toBeNull()
    expect(row('Status')).toHaveFocus()
  })

  it('moves the focused row with Alt and an arrow, and keeps it focused', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor()
    await ready()
    row('Overview').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(latest().map((item) => item.kind)).toEqual(['group', 'document'])
    expect(row('Overview')).toHaveFocus()
    // Nothing past the end.
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(latest().map((item) => item.kind)).toEqual(['group', 'document'])
  })

  it('moves an item from its menu, named for the item it acts on', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor()
    await ready()
    await user.click(screen.getByRole('button', { name: 'More actions for Overview' }))
    expect(await screen.findByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
    expect(latest().map((item) => item.kind)).toEqual(['group', 'document'])
  })

  it('shows a deleted target as one to fix, and repoints it with the combobox, keeping the label', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([{ kind: 'document', id: GONE, label: 'Old page' }])
    expect(await within(row('Old page')).findByText('Deleted')).toBeVisible()

    await user.click(row('Old page'))
    expect(
      screen.getByText('This document no longer exists. Choose another, or remove the link.'),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Choose another' }))
    const field = screen.getByRole('combobox', { name: 'Links to' })
    expect(field).toHaveFocus()
    await user.type(field, 'sync')
    const option = await screen.findByRole('option', { name: 'The sync map' })
    expect(option).toHaveAccessibleDescription(/Engineering.*Architecture/u)
    await user.keyboard('{Enter}')

    expect(latest()).toEqual([{ kind: 'document', id: SYNC, label: 'Old page' }])
  })

  it('adds a link by keyboard — search, arrow to a collection, Enter — and opens it', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([])
    await user.click(screen.getByRole('button', { name: 'Add a link' }))
    const field = screen.getByRole('combobox', { name: 'Add a link' })
    expect(field).toHaveFocus()
    await user.type(field, 'guid')
    await screen.findByRole('option', { name: 'Guides' })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(latest()).toEqual([{ kind: 'collection', id: GUIDES }])
    expect(screen.queryByRole('combobox', { name: 'Add a link' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Guides', expanded: true })).toBeVisible()
  })

  it('says when nothing matches, and closes the composer on a second Escape', async () => {
    const user = userEvent.setup()
    renderEditor([])
    await user.click(screen.getByRole('button', { name: 'Add a link' }))
    await user.type(screen.getByRole('combobox', { name: 'Add a link' }), 'zzz')
    expect(await screen.findByText(/Nothing matches “zzz”/)).toBeVisible()
    await user.keyboard('{Escape}{Escape}')
    expect(screen.queryByRole('combobox', { name: 'Add a link' })).toBeNull()
  })

  it('accepts a pasted address, labelled by its host, and refuses a script address', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([])
    await user.click(screen.getByRole('button', { name: 'Add a link' }))
    const field = screen.getByRole('combobox', { name: 'Add a link' })

    await user.type(field, 'https://evil.test@x')
    expect(screen.getByText(/Use a full https:\/\/ address/)).toBeVisible()
    expect(screen.queryByRole('option')).toBeNull()

    await user.clear(field)
    await user.type(field, 'https://status.example.com')
    await user.keyboard('{Enter}')
    expect(latest()).toEqual([
      { kind: 'url', href: 'https://status.example.com', label: 'status.example.com' },
    ])
  })

  it('offers an external link a switch to stop hiding this site from it, and no other link', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([
      { kind: 'url', href: 'https://partner.test', label: 'Partner' },
      { kind: 'url', href: '/s/handbook', label: 'Handbook' },
    ])
    await user.click(row('Handbook'))
    expect(screen.queryByRole('switch')).toBeNull()

    await user.click(row('Partner'))
    const toggle = screen.getByRole('switch', { name: 'Hide this site from the destination' })
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleDescription(
      'The destination sees your site’s address, never the page.',
    )
    await user.click(toggle)
    expect(latest()[0]).toEqual({
      kind: 'url',
      href: 'https://partner.test',
      label: 'Partner',
      referrer: 'sent',
    })
  })

  it('edits a label in place, and an empty label goes back to the title', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor()
    await ready()
    await user.click(row('Overview'))
    const label = screen.getByLabelText('Label')
    await user.type(label, 'Start here')
    expect(label).toHaveFocus()
    expect(latest()[0]).toEqual({ kind: 'document', id: OVERVIEW, label: 'Start here' })
    await user.clear(label)
    expect(latest()[0]).toEqual({ kind: 'document', id: OVERVIEW })
  })

  it('nests a link in a dropdown and lifts it back out, from the row’s menu', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor()
    await ready()
    await user.click(screen.getByRole('button', { name: 'More actions for Overview' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Move into “Reference”' }))
    expect(latest()).toEqual([
      {
        kind: 'group',
        label: 'Reference',
        items: [
          ...(MENU[1]?.kind === 'group' ? MENU[1].items : []),
          { kind: 'document', id: OVERVIEW },
        ],
      },
    ])

    await user.click(screen.getByRole('button', { name: 'More actions for Overview' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Move out of the dropdown' }))
    expect(latest().map((item) => item.kind)).toEqual(['group', 'document'])
  })

  it('reorders and nests by dragging the handle', async () => {
    const { latest, container } = renderEditor()
    await ready()
    const handles = container.querySelectorAll('[title="Drag to move"]')
    const rows = within(items()).getAllByRole('listitem')
    const [overviewHandle] = handles
    const groupRow = rows[1]
    if (overviewHandle === undefined || groupRow === undefined) throw new Error('rows missing')

    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => undefined }
    groupRow.getBoundingClientRect = () => ({ top: 0, height: 100 }) as DOMRect
    fireEvent.dragStart(overviewHandle, { dataTransfer })
    fireEvent.dragOver(groupRow, { dataTransfer, clientY: 50 })
    expect(groupRow).toHaveAttribute('data-drop', 'inside')
    fireEvent.drop(groupRow, { dataTransfer, clientY: 50 })

    await waitFor(() => {
      expect(latest()).toHaveLength(1)
    })
    const [group] = latest()
    expect(group?.kind === 'group' ? group.items.at(-1) : undefined).toEqual({
      kind: 'document',
      id: OVERVIEW,
    })
  })

  it('adds a dropdown, open for its label, and says what it still needs', async () => {
    const user = userEvent.setup()
    const { latest } = renderEditor([])
    await user.click(screen.getByRole('button', { name: 'Add a dropdown' }))
    expect(latest()).toEqual([{ kind: 'group', label: '', items: [] }])
    const dropdown = screen.getByRole('button', { name: 'Untitled dropdown', expanded: true })
    expect(within(dropdown).getByText('Needs a label')).toBeVisible()
    expect(screen.getByText('Give it a label.')).toBeVisible()
    expect(screen.getByText(/No links yet/)).toBeVisible()
  })

  it('previews the header with only what a reader will see, naming what it leaves out', async () => {
    renderEditor([...MENU, { kind: 'document', id: GONE }])
    const preview = screen.getByRole('figure')
    await waitFor(() => {
      expect(within(preview).getByText('Overview')).toBeVisible()
    })
    expect(within(preview).getByText('Reference')).toBeVisible()
    expect(within(preview).queryByText('Sync')).toBeNull()
    expect(
      within(preview).getByText(
        'Sync isn’t shown: it’s not on the web. A deleted document isn’t shown: it no longer exists.',
      ),
    ).toBeVisible()
  })

  it('says so when the targets cannot be looked up', async () => {
    const user = userEvent.setup()
    renderEditor([{ kind: 'document', id: OVERVIEW, label: 'Start' }], {
      'GET /api/settings/organisation/public-menu/targets': () =>
        errorResponse(500, 'internal', 'down'),
    })
    expect(await within(row('Start')).findByText('Not checked')).toBeVisible()
    await user.click(row('Start'))
    expect(screen.getByText('Could not check this document just now.')).toBeVisible()
  })

  it('has no accessibility violations: collapsed, open, and with the composer searching', async () => {
    const user = userEvent.setup()
    const { container } = renderEditor()
    await ready()
    await expectNoAccessibilityViolations(container)
    await user.click(row('Status'))
    await expectNoAccessibilityViolations(container)
    await user.click(screen.getByRole('button', { name: 'Add a link' }))
    await user.type(screen.getByRole('combobox', { name: 'Add a link' }), 'sync')
    await screen.findByRole('option', { name: 'The sync map' })
    await expectNoAccessibilityViolations(container)
  })
})
