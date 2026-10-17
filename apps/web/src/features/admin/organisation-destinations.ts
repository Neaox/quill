/**
 * The settings screens' home. They have a navigation of their own (the settings frame), so the
 * person menu offers them as one item, "Organisation settings", and this redirects to the first.
 */
export const ORGANISATION_SETTINGS_HOME = '/admin/settings'

/** The unit and workspace tree: organisation administration that is not one of the settings screens. */
export const ORGANISATION_STRUCTURE = '/admin/organisation'

/**
 * Every place an instance administrator goes to change the organisation, in
 * the order the person menu, the command palette and the home page list them
 * (`docs/design/chrome.md`, "Reaching settings").
 *
 * One list, read by all three, so a screen added to `/admin/settings` cannot
 * be reachable from one and missing from the others. The settings screens
 * come first and in the order of their own navigation (`SETTINGS_SECTIONS`,
 * which a test holds this to); the unit and workspace tree follows, because it
 * is organisation administration too but is not a settings screen.
 *
 * The first is called "Organisation settings" rather than the navigation's
 * "Organisation": in the settings frame it sits under a "Settings" heading,
 * and in a menu or a palette it does not.
 *
 * Who may see them is not decided here: every one of these routes answers
 * not-found to anybody but an instance administrator (`me.isInstanceAdmin`,
 * the check `routes/_authenticated/admin/**` make), and the callers ask the
 * same question before offering them.
 */
export const ORGANISATION_DESTINATIONS = [
  {
    to: '/admin/settings/organisation',
    label: 'Organisation settings',
    keywords: ['settings', 'admin', 'name', 'logo', 'navigation', 'policies'],
  },
  {
    to: '/admin/settings/theme',
    label: 'Theme',
    keywords: ['settings', 'admin', 'colour', 'color', 'accent', 'brand', 'identity'],
  },
  {
    to: '/admin/settings/labels',
    label: 'Labels and emoji',
    keywords: ['settings', 'admin', 'labels', 'pills', 'tags', 'emoji', 'logos', 'images'],
  },
  {
    to: '/admin/settings/layout',
    label: 'Layout',
    keywords: ['settings', 'admin', 'sidebar', 'variants'],
  },
  {
    to: '/admin/settings/links',
    label: 'Links',
    keywords: ['settings', 'admin', 'link', 'previews', 'unfurl', 'open graph', 'block', 'sites'],
  },
  {
    to: '/admin/settings/secrets',
    label: 'Secrets and sign-in',
    keywords: ['settings', 'admin', 'sso', 'oidc', 'single sign-on', 'keys', 'providers'],
  },
  {
    to: ORGANISATION_STRUCTURE,
    label: 'Units and workspaces',
    keywords: ['admin', 'organisation', 'manage', 'create', 'new workspace', 'new unit'],
  },
] as const

export type OrganisationDestination = (typeof ORGANISATION_DESTINATIONS)[number]
