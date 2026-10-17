import {
  ChevronDownIcon,
  MenuButton,
  SettingsIcon,
  SignOutIcon,
  UserIcon,
  WorkspacesIcon,
  tv,
  type MenuSection,
} from '@quill/ui'

import { useMe, useSignOut } from '../../lib/api/index.ts'
import { NotificationsBell } from '../notifications/notifications-bell.tsx'
import { RouterLink } from '../../lib/routing/router-link.tsx'
import {
  ORGANISATION_SETTINGS_HOME,
  ORGANISATION_STRUCTURE,
} from '../admin/organisation-destinations.ts'
import { colourSchemeLabel, nextColourScheme } from '../theme/colour-schemes.ts'
import { SCHEME_ICONS } from '../theme/theme-toggle.tsx'
import { useThemePreference } from '../theme/use-theme-preference.ts'

export const signedInHeaderStyles = tv({
  slots: {
    avatar: [
      'flex size-6 shrink-0 items-center justify-center rounded-full bg-surface',
      'text-2xs font-semibold text-foreground-soft ring-1 ring-border',
    ],
    /*
     * The name and chevron give way below `sm` in every bar: a phone's bar
     * holds the organisation's name, search and the page's own controls, and
     * the avatar still says whose session it is — the full name is in the
     * button's accessible name and at the top of the open menu.
     */
    name: 'hidden max-w-40 truncate font-medium sm:block',
    chevron: 'hidden size-3.5 shrink-0 text-muted sm:block',
    // Who is signed in, at the top of the panel: the initials larger, the name and email beside them.
    who: 'flex min-w-0 items-center gap-3',
    whoAvatar: [
      'flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-subtle',
      'text-xs font-semibold text-foreground ring-1 ring-border',
    ],
    whoText: 'flex min-w-0 flex-col',
    headerName: 'truncate text-sm font-medium text-foreground',
    headerEmail: 'truncate text-xs text-muted',
  },
})

/** One or two letters for the avatar: the first and the last word's first character. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '')
  const first = words.at(0)
  const last = words.length > 1 ? words.at(-1) : undefined
  return [first, last]
    .map((word) => (word === undefined ? '' : ([...word][0] ?? '')))
    .join('')
    .toLocaleUpperCase()
}

/**
 * The person menu: who is signed in, and everything that belongs to them
 * rather than to the page (`docs/design/chrome.md`, "Reaching settings").
 *
 * - **Who**, first: the initials, the name and the email, so a person with
 *   two accounts can tell which one this is.
 * - **Preferences**, the person's own settings that follow them to every
 *   device (ADR-034), such as how animated images play (ADR-047), and
 *   **Appearance**, their colour scheme (ADR-028, layer 3): one row that goes
 *   round System, Light and Dark each time it is pressed, with the scheme it
 *   is on beside it. It is set once and left alone, so it lives here, and the
 *   menu stays open so the change can be seen and pressed again.
 * - **Organisation**, for an instance administrator only, in two items: its
 *   settings, whose screens have a navigation of their own, and its units and
 *   workspaces. The same `isInstanceAdmin` the `/admin` routes gate on, so
 *   nobody is offered a page that would answer not-found. The palette and the
 *   home page still list each screen by name.
 * - **Sign out**, last, where every product puts it.
 *
 * Rendered only inside a signed-in surface, where `me` is already loaded by
 * the route's `beforeLoad`, so there is no loading state of its own.
 */
export function SignedInHeader() {
  const me = useMe()
  const signOut = useSignOut()
  const { preference, setPreference } = useThemePreference()
  const styles = signedInHeaderStyles()

  if (me.data === undefined) return undefined
  const { displayName, email, isInstanceAdmin } = me.data

  const sections: readonly MenuSection[] = [
    {
      id: 'person',
      entries: [
        {
          kind: 'link',
          label: 'Preferences',
          icon: <UserIcon />,
          target: { to: '/preferences' },
        },
        {
          kind: 'action',
          label: 'Appearance',
          icon: SCHEME_ICONS[preference],
          hint: colourSchemeLabel(preference),
          keepOpen: true,
          onSelect: () => {
            setPreference(nextColourScheme(preference))
          },
        },
      ],
    },
    {
      id: 'organisation',
      label: 'Organisation',
      entries: isInstanceAdmin
        ? [
            {
              kind: 'link' as const,
              label: 'Organisation settings',
              icon: <SettingsIcon />,
              target: { to: ORGANISATION_SETTINGS_HOME },
            },
            {
              kind: 'link' as const,
              label: 'Units and workspaces',
              icon: <WorkspacesIcon />,
              target: { to: ORGANISATION_STRUCTURE },
            },
          ]
        : [],
    },
    {
      id: 'session',
      entries: [
        {
          kind: 'action',
          label: 'Sign out',
          icon: <SignOutIcon />,
          disabled: signOut.isPending,
          onSelect: () => {
            signOut.mutate()
          },
        },
      ],
    },
  ]

  return (
    <>
      <NotificationsBell />
      <MenuButton
        label={`Account menu for ${displayName}`}
        linkComponent={RouterLink}
        header={
          <span className={styles.who()}>
            <span aria-hidden="true" className={styles.whoAvatar()}>
              {initialsOf(displayName)}
            </span>
            <span className={styles.whoText()}>
              <span className={styles.headerName()}>{displayName}</span>
              <span className={styles.headerEmail()}>{email}</span>
            </span>
          </span>
        }
        sections={sections}
      >
        <span className={styles.avatar()}>{initialsOf(displayName)}</span>
        <span className={styles.name()}>{displayName}</span>
        <ChevronDownIcon className={styles.chevron()} />
      </MenuButton>
    </>
  )
}
