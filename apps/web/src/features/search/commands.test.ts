import { describe, expect, it, vi } from 'vitest'

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
      'Links',
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
      'Links',
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

  describe('from the open editor', () => {
    const editor = [
      {
        id: 'editor:link-show-card',
        label: 'Show link as card',
        keywords: ['link', 'preview'],
        run: () => undefined,
      },
      {
        id: 'editor:link-show-inline',
        label: 'Show link as inline',
        keywords: ['link'],
        run: () => undefined,
      },
    ]
    const withEditor = (query: string) =>
      matchCommands(
        paletteCommands({ isInstanceAdmin: false, workspaces: WORKSPACES, editor }),
        query,
      )

    it('are listed first and before anything is typed, since they are about where the cursor is', () => {
      expect(withEditor('').map((command) => command.label)).toEqual([
        'Show link as card',
        'Show link as inline',
        'Home',
        'Sign out',
      ])
    })

    it('are found by what they do and by the words an author would type', () => {
      expect(withEditor('card').map((command) => command.label)).toEqual(['Show link as card'])
      expect(withEditor('preview').map((command) => command.label)).toEqual(['Show link as card'])
    })

    it('sit in a group of their own, ahead of the places to go', () => {
      const groups = commandGroups(withEditor(''))
      expect(groups.map((group) => group.label)).toEqual(['At the cursor', 'Go to', 'Account'])
      expect(groups[0]?.options.map((option) => option.label)).toEqual([
        'Show link as card',
        'Show link as inline',
      ])
    })

    it('run what the editor gave them', () => {
      const run = vi.fn<() => void>()
      const [command] = matchCommands(
        paletteCommands({
          isInstanceAdmin: false,
          workspaces: [],
          editor: [{ id: 'x', label: 'Do x', keywords: [], run }],
        }),
        'do x',
      )
      if (command?.action.kind !== 'editor') throw new Error('expected an editor command')
      command.action.run()
      expect(run).toHaveBeenCalledOnce()
    })

    it('are absent when no editor is open', () => {
      expect(labels('card', true)).toEqual([])
    })
  })
})
