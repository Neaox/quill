import { describe, expect, it } from 'vitest'

import { commandGroups, matchCommands, paletteCommands } from './commands.ts'

const WORKSPACES = [
  {
    id: 'ws-1',
    unitId: 'unit-1',
    name: 'Engineering',
    slug: 'engineering',
    createdAt: '2026-01-01T00:00:00.000Z',
    unit: { id: 'unit-1', name: 'Acme', path: ['Acme'] },
  },
]

const labels = (query: string, isInstanceAdmin: boolean) =>
  matchCommands(paletteCommands({ isInstanceAdmin, workspaces: WORKSPACES }), query).map(
    (command) => command.label,
  )

describe('the palette’s commands', () => {
  it('offer an administrator the organisation’s settings before anything is typed', () => {
    expect(labels('', true)).toEqual([
      'Home',
      'Organisation settings',
      'Theme',
      'Labels and emoji',
      'Layout',
      'Secrets and sign-in',
      'Units and workspaces',
      'Sign out',
    ])
  })

  it('never offer the organisation’s settings to somebody who is not an administrator', () => {
    expect(labels('', false)).toEqual(['Home', 'Sign out'])
    expect(labels('settings', false)).toEqual([])
    expect(labels('theme', false)).toEqual([])
  })

  it('match on every word, in any case, by name or by keyword', () => {
    expect(labels('THEME settings', true)).toEqual(['Theme'])
    expect(labels('sso', true)).toEqual(['Secrets and sign-in'])
    expect(labels('emoji', true)).toEqual(['Labels and emoji'])
    expect(labels('log out', false)).toEqual(['Sign out'])
    expect(labels('settings', true)).toEqual([
      'Organisation settings',
      'Theme',
      'Labels and emoji',
      'Layout',
      'Secrets and sign-in',
    ])
  })

  it('wait for a workspace to be asked for by name, then go straight to it', () => {
    const [workspace] = matchCommands(
      paletteCommands({ isInstanceAdmin: false, workspaces: WORKSPACES }),
      'engin',
    )

    expect(workspace?.action).toEqual({ kind: 'workspace', workspaceSlug: 'engineering' })
  })

  it('group what matched under Go to, Organisation and Account, leaving empty groups out', () => {
    const groups = commandGroups(
      matchCommands(paletteCommands({ isInstanceAdmin: false, workspaces: WORKSPACES }), ''),
    )

    expect(groups.map((group) => group.label)).toEqual(['Go to', 'Account'])
    expect(groups[1]?.options).toEqual([{ id: 'command:sign-out', label: 'Sign out' }])
  })
})
