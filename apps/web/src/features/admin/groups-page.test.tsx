import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'

const me = (isInstanceAdmin: boolean) => () =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'admin@example.com',
    displayName: 'Admin',
    emailVerified: true,
    isInstanceAdmin,
  })

interface Person {
  id: string
  name: string
  email: string
}

const ALICE: Person = { id: 'u-alice', name: 'Alice Ng', email: 'alice@example.com' }
const BOB: Person = { id: 'u-bob', name: 'Bob Okafor', email: 'bob@example.com' }
const CARA: Person = { id: 'u-cara', name: 'Cara Diaz', email: 'cara@example.com' }

interface Group {
  id: string
  name: string
  unitId: string
  unitPath: string
  parentGroupId: string | null
}

/**
 * A small directory the fake routes read and write, so a test sees what a
 * real server would answer after its own change.
 */
function directory(
  seed: {
    groups?: Group[]
    members?: Record<string, Person[]>
    extra?: FakeRoutes
    admin?: boolean
  } = {},
) {
  const groups: Group[] = seed.groups ?? [
    { id: 'g-design', name: 'Design', unitId: 'unit-1', unitPath: 'Acme', parentGroupId: null },
    {
      id: 'g-eng',
      name: 'Engineering',
      unitId: 'unit-1',
      unitPath: 'Acme',
      parentGroupId: null,
    },
    {
      id: 'g-platform',
      name: 'Platform',
      unitId: 'unit-1',
      unitPath: 'Acme',
      parentGroupId: 'g-eng',
    },
    {
      id: 'g-oncall',
      name: 'Oncall',
      unitId: 'unit-2',
      unitPath: 'Acme / Support',
      parentGroupId: null,
    },
  ]
  const members: Record<string, Person[]> = seed.members ?? { 'g-design': [ALICE] }
  const everyone = [ALICE, BOB, CARA]
  const calls: string[] = []

  const routes: FakeRoutes = {
    'GET /api/me': me(seed.admin ?? true),
    'GET /api/groups': () =>
      jsonResponse(200, {
        groups: groups.map((group) => ({
          ...group,
          memberCount: members[group.id]?.length ?? 0,
        })),
      }),
    'GET /api/groups/{id}/members': (_request, params) =>
      jsonResponse(200, { members: members[params['id'] ?? ''] ?? [] }),
    'GET /api/people': (request) => {
      const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? ''
      return jsonResponse(200, {
        people: everyone.filter(
          (person) =>
            person.name.toLowerCase().startsWith(q) || person.email.toLowerCase().startsWith(q),
        ),
      })
    },
    'PUT /api/groups/{id}/members/{userId}': (_request, params) => {
      const id = params['id'] ?? ''
      const person = everyone.find((entry) => entry.id === params['userId'])
      if (person !== undefined) members[id] = [...(members[id] ?? []), person]
      calls.push(`add ${id} ${params['userId'] ?? ''}`)
      return new Response(null, { status: 204 })
    },
    'DELETE /api/groups/{id}/members/{userId}': (_request, params) => {
      const id = params['id'] ?? ''
      members[id] = (members[id] ?? []).filter((entry) => entry.id !== params['userId'])
      calls.push(`remove ${id} ${params['userId'] ?? ''}`)
      return new Response(null, { status: 204 })
    },
    'GET /api/units': () =>
      jsonResponse(200, [
        {
          id: 'unit-1',
          parentId: null,
          name: 'Acme',
          slug: 'acme',
          label: 'company',
          createdAt: '',
        },
        {
          id: 'unit-2',
          parentId: 'unit-1',
          name: 'Support',
          slug: 'support',
          label: 'team',
          createdAt: '',
        },
      ]),
    ...seed.extra,
  }
  return { routes, groups, members, calls }
}

const listItem = (name: string) =>
  within(screen.getByRole('navigation', { name: 'Groups' })).getByRole('link', {
    name: new RegExp(`^${name}`),
  })

describe('the people and groups page', () => {
  it('lists groups under their unit, with nested groups under their parent and the member counts', async () => {
    renderApp('/admin/groups', directory().routes)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'People and groups' }),
    ).toBeInTheDocument()
    const list = screen.getByRole('navigation', { name: 'Groups' })
    expect(within(list).getByRole('group', { name: 'Acme' })).toBeInTheDocument()
    expect(within(list).getByRole('group', { name: 'Acme / Support' })).toBeInTheDocument()
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Design1 member', 'Engineering0 members', 'Platform0 members', 'Oncall0 members'])
    expect(screen.getByText('Choose a group to see who is in it.')).toBeInTheDocument()
  })

  it('shows who is in a group once it is chosen, and marks it as current', async () => {
    renderApp('/admin/groups', directory().routes)

    await userEvent.click(await screen.findByRole('link', { name: /^Design/ }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Design' })).toBeInTheDocument()
    const members = await screen.findByRole('list', { name: 'Members of Design' })
    expect(within(members).getByText('Alice Ng')).toBeInTheDocument()
    expect(within(members).getByText('alice@example.com')).toBeInTheDocument()
    expect(listItem('Design')).toHaveAttribute('aria-current', 'page')
  })

  it('opens straight onto the group in the address', async () => {
    renderApp('/admin/groups?group=g-design', directory().routes)

    expect(await screen.findByRole('list', { name: 'Members of Design' })).toBeInTheDocument()
  })

  it('says so when the group in the address is gone', async () => {
    renderApp('/admin/groups?group=g-nope', directory().routes)

    expect(await screen.findByText(/That group no longer exists/)).toBeInTheDocument()
  })

  it('says a group is empty and how to fill it', async () => {
    renderApp('/admin/groups?group=g-eng', directory().routes)

    expect(await screen.findByText(/Nobody is in this group yet/)).toBeInTheDocument()
  })

  it('adds a person found by searching, and offers nobody who is already in', async () => {
    const { routes, calls } = directory()
    renderApp('/admin/groups?group=g-design', routes)

    const field = await screen.findByRole('combobox', { name: 'Add people' })
    await userEvent.type(field, 'b')
    // The list narrows as the search settles, from everyone not yet in.
    const option = await screen.findByRole('option', { name: 'Bob Okafor' })
    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(1)
    })
    await userEvent.click(option)

    await waitFor(() => {
      expect(calls).toEqual(['add g-design u-bob'])
    })
    const members = await screen.findByRole('list', { name: 'Members of Design' })
    expect(await within(members).findByText('Bob Okafor')).toBeInTheDocument()
    expect(field).toHaveValue('')

    // Alice is already in; searching for her finds nobody new.
    await userEvent.type(field, 'ali')
    expect(await screen.findByText(/Nobody new matches “ali”/)).toBeInTheDocument()
  })

  it('adds with the keyboard alone', async () => {
    const { routes, calls } = directory()
    renderApp('/admin/groups?group=g-design', routes)

    const field = await screen.findByRole('combobox', { name: 'Add people' })
    await userEvent.type(field, 'cara')
    await screen.findByRole('option', { name: /Cara Diaz/ })
    await userEvent.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => {
      expect(calls).toEqual(['add g-design u-cara'])
    })
  })

  it('removes a member', async () => {
    const { routes, calls } = directory()
    renderApp('/admin/groups?group=g-design', routes)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove Alice Ng from Design' }),
    )

    await waitFor(() => {
      expect(calls).toEqual(['remove g-design u-alice'])
    })
    expect(await screen.findByText(/Nobody is in this group yet/)).toBeInTheDocument()
  })

  it('creates a group in a unit, and shows it', async () => {
    const bodies: unknown[] = []
    const { routes, groups } = directory({
      extra: {
        'POST /api/groups': async (request) => {
          const body = (await request.json()) as { unitId: string; name: string }
          bodies.push(body)
          groups.push({
            id: 'g-new',
            name: body.name,
            unitId: body.unitId,
            unitPath: 'Acme / Support',
            parentGroupId: null,
          })
          return jsonResponse(201, { id: 'g-new', ...body, parentGroupId: null })
        },
      },
    })
    renderApp('/admin/groups', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'New group' }))
    const dialog = await screen.findByRole('dialog', { name: 'New group' })
    await userEvent.type(within(dialog).getByLabelText('Name', { exact: false }), 'Helpdesk')
    await userEvent.selectOptions(within(dialog).getByLabelText('Unit', { exact: false }), 'unit-2')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(bodies).toEqual([{ unitId: 'unit-2', name: 'Helpdesk' }])
    })
    // The new group is chosen once it exists.
    expect(await screen.findByRole('heading', { level: 2, name: 'Helpdesk' })).toBeInTheDocument()
  })

  it('creates a group inside the chosen one, in its unit', async () => {
    const bodies: unknown[] = []
    const { routes } = directory({
      extra: {
        'POST /api/groups': async (request) => {
          bodies.push(await request.json())
          return jsonResponse(201, { id: 'g-new' })
        },
      },
    })
    renderApp('/admin/groups?group=g-eng', routes)

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for Engineering' }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'New group inside…' }))
    const dialog = await screen.findByRole('dialog', { name: 'New group' })
    await userEvent.type(within(dialog).getByLabelText('Name', { exact: false }), 'Security')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(bodies).toEqual([{ unitId: 'unit-1', name: 'Security', parentGroupId: 'g-eng' }])
    })
  })

  it('reports a refused name rather than swallowing it', async () => {
    const { routes } = directory({
      extra: {
        'POST /api/groups': () =>
          errorResponse(409, 'group_name_taken', 'A group with that name already exists here'),
      },
    })
    renderApp('/admin/groups', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'New group' }))
    const dialog = await screen.findByRole('dialog', { name: 'New group' })
    await userEvent.type(within(dialog).getByLabelText('Name', { exact: false }), 'Design')
    await userEvent.selectOptions(within(dialog).getByLabelText('Unit', { exact: false }), 'unit-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A group with that name already exists here',
    )
  })

  it('renames a group', async () => {
    const names: string[] = []
    const { routes } = directory({
      extra: {
        'PATCH /api/groups/{id}': async (request) => {
          names.push(((await request.json()) as { name: string }).name)
          return jsonResponse(200, { id: 'g-design' })
        },
      },
    })
    renderApp('/admin/groups?group=g-design', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Design' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }))
    const dialog = await screen.findByRole('dialog', { name: /Rename/ })
    const field = within(dialog).getByLabelText('Name', { exact: false })
    await userEvent.clear(field)
    await userEvent.type(field, 'Product design')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(names).toEqual(['Product design'])
    })
  })

  it('says what deleting takes with it before it deletes, then deletes', async () => {
    const deleted: string[] = []
    const { routes } = directory({
      extra: {
        'DELETE /api/groups/{id}': (_request, params) => {
          deleted.push(params['id'] ?? '')
          return jsonResponse(200, { members: 1, grants: 2 })
        },
      },
    })
    renderApp('/admin/groups?group=g-design', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Design' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))
    const dialog = await screen.findByRole('dialog', { name: /Delete/ })
    expect(within(dialog).getByText(/1 person will no longer be in it/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Every grant that gives this group access/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleted).toEqual(['g-design'])
    })
    // Back to the list, with nothing chosen.
    expect(await screen.findByText('Choose a group to see who is in it.')).toBeInTheDocument()
  })

  it('does not offer to delete a group that has groups inside it', async () => {
    renderApp('/admin/groups?group=g-eng', directory().routes)

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for Engineering' }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))

    const dialog = await screen.findByRole('dialog', { name: /Delete/ })
    expect(within(dialog).getByText(/One group is nested inside it/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('invites the first group when there are none', async () => {
    renderApp('/admin/groups', directory({ groups: [], members: {} }).routes)

    expect(await screen.findByText('No groups yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New group' })).toBeEnabled()
  })

  it('is not there for somebody who does not administer the instance', async () => {
    renderApp('/admin/groups', directory({ admin: false }).routes)

    expect(await screen.findByText('This page is not available')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'People and groups' })).not.toBeInTheDocument()
  })

  it('has no axe violations, with a group chosen', async () => {
    const { container } = renderApp('/admin/groups?group=g-design', directory().routes)
    await screen.findByRole('list', { name: 'Members of Design' })

    await expectNoAccessibilityViolations(container)
  })

  it('has no axe violations, with the new group dialog open', async () => {
    renderApp('/admin/groups', directory().routes)

    await userEvent.click(await screen.findByRole('button', { name: 'New group' }))
    const dialog = await screen.findByRole('dialog', { name: 'New group' })

    await expectNoAccessibilityViolations(dialog)
  })
})
