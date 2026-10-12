import type { CommandPaletteGroup } from '@quill/ui'

import type { WorkspaceSummaryDto } from '../../lib/api/index.ts'
import { workspaceReference } from '../../lib/routing/document-reference.ts'
import {
  ORGANISATION_DESTINATIONS,
  type OrganisationDestination,
} from '../admin/organisation-destinations.ts'

/**
 * The palette's commands: places to go and the one thing to do from anywhere
 * (`docs/design/chrome.md`, "Reaching settings").
 *
 * Commands are data, and what running one means is the dialog's: a command
 * names its destination as a discriminated union rather than a URL, so the
 * dialog navigates through the router's typed `navigate` and nothing here
 * builds an address (ADR-035).
 */
export type CommandAction =
  | { readonly kind: 'home' }
  | { readonly kind: 'workspace'; readonly workspaceSlug: string }
  | { readonly kind: 'organisation'; readonly to: OrganisationDestination['to'] }
  | { readonly kind: 'sign-out' }

export interface PaletteCommand {
  /** Unique across commands and distinct from every search hit's option id. */
  readonly id: string
  readonly label: string
  readonly group: CommandGroupId
  /** Other words somebody might type for it: "settings" for Theme, "log out" for Sign out. */
  readonly keywords: readonly string[]
  readonly action: CommandAction
  /** Listed before anything is typed. Workspaces wait to be asked for by name. */
  readonly suggested: boolean
}

/** The palette's command groups, in the order it lists them. */
const COMMAND_GROUPS = [
  { id: 'go-to', label: 'Go to' },
  { id: 'organisation', label: 'Organisation' },
  { id: 'account', label: 'Account' },
] as const

type CommandGroupId = (typeof COMMAND_GROUPS)[number]['id']

export interface CommandContext {
  readonly isInstanceAdmin: boolean
  readonly workspaces: readonly WorkspaceSummaryDto[]
}

/** Every command this person may run, in the order the palette lists them. */
export function paletteCommands({ isInstanceAdmin, workspaces }: CommandContext): PaletteCommand[] {
  return [
    {
      id: 'command:home',
      label: 'Home',
      group: 'go-to',
      keywords: ['dashboard', 'start'],
      action: { kind: 'home' },
      suggested: true,
    },
    ...workspaces.map((workspace): PaletteCommand => ({
      id: `command:workspace:${workspace.id}`,
      label: workspace.name,
      group: 'go-to',
      keywords: ['workspace', workspace.unit.name],
      action: { kind: 'workspace', workspaceSlug: workspaceReference(workspace) },
      suggested: false,
    })),
    // The same question the `/admin` routes ask, so nobody is offered a page
    // that would answer not-found.
    ...(isInstanceAdmin
      ? ORGANISATION_DESTINATIONS.map((destination): PaletteCommand => ({
          id: `command:${destination.to}`,
          label: destination.label,
          group: 'organisation',
          keywords: destination.keywords,
          action: { kind: 'organisation', to: destination.to },
          suggested: true,
        }))
      : []),
    {
      id: 'command:sign-out',
      label: 'Sign out',
      group: 'account',
      keywords: ['log out', 'logout', 'sign off'],
      action: { kind: 'sign-out' },
      suggested: true,
    },
  ]
}

/**
 * The commands a query asks for.
 *
 * Nothing typed: the suggested ones, so the palette is a map of where things
 * are before it is a search box. Something typed: every command whose name or
 * keywords contain each word of it, in any order and any case — "theme
 * settings" finds Theme, "sso" finds Secrets and sign-in.
 */
export function matchCommands(
  commands: readonly PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const words = query
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== '')
  if (words.length === 0) return commands.filter((command) => command.suggested)
  return commands.filter((command) => {
    const haystack = [command.label, ...command.keywords].join(' ').toLocaleLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** The matched commands as palette groups, in the order the groups were declared. */
export function commandGroups(commands: readonly PaletteCommand[]): CommandPaletteGroup[] {
  const byGroup = Map.groupBy(commands, (command) => command.group)
  return COMMAND_GROUPS.flatMap(({ id, label }) => {
    const members = byGroup.get(id)
    return members === undefined
      ? []
      : [
          {
            id: `commands-${id}`,
            label,
            options: members.map((command) => ({ id: command.id, label: command.label })),
          },
        ]
  })
}
