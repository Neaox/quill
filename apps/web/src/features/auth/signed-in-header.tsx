import { ChevronDownIcon, MenuButton, isThemePreference, tv, type MenuSection } from '@quill/ui'

import { useMe, useSignOut } from '../../lib/api/index.ts'
import { RouterLink } from '../../lib/routing/router-link.tsx'
import { ORGANISATION_DESTINATIONS } from '../admin/organisation-destinations.ts'
import { COLOUR_SCHEMES } from '../theme/colour-schemes.ts'
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
 * - **Appearance**, the person's own colour scheme (ADR-028, layer 3). It
 *   lives here rather than as a switch in every bar because it is set once
 *   and then left alone, and because a phone-width bar has no room for it —
 *   in the menu it is reachable at every width.
 * - **Organisation**, for an instance administrator only: the settings
 *   screens and the unit tree. The same `isInstanceAdmin` the `/admin`
 *   routes gate on, so nobody is offered a page that would answer not-found.
 * - **Preferences**, the person's own settings that follow them to every
 *   device (ADR-034), such as how animated images play (ADR-047). Beside
 *   Sign out, where people look for their account's settings.
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
      id: 'appearance',
      entries: [
        {
          kind: 'choice',
          label: 'Appearance',
          value: preference,
          options: COLOUR_SCHEMES,
          onValueChange: (value) => {
            if (isThemePreference(value)) setPreference(value)
          },
        },
      ],
    },
    {
      id: 'organisation',
      label: 'Organisation',
      entries: isInstanceAdmin
        ? ORGANISATION_DESTINATIONS.map((destination) => ({
            kind: 'link' as const,
            label: destination.label,
            target: { to: destination.to },
          }))
        : [],
    },
    {
      id: 'person',
      entries: [{ kind: 'link', label: 'Preferences', target: { to: '/preferences' } }],
    },
    {
      id: 'session',
      entries: [
        {
          kind: 'action',
          label: 'Sign out',
          disabled: signOut.isPending,
          onSelect: () => {
            signOut.mutate()
          },
        },
      ],
    },
  ]

  return (
    <MenuButton
      label={`Account menu for ${displayName}`}
      linkComponent={RouterLink}
      header={
        <>
          <span className={styles.headerName()}>{displayName}</span>
          <span className={styles.headerEmail()}>{email}</span>
        </>
      }
      sections={sections}
    >
      <span className={styles.avatar()}>{initialsOf(displayName)}</span>
      <span className={styles.name()}>{displayName}</span>
      <ChevronDownIcon className={styles.chevron()} />
    </MenuButton>
  )
}
