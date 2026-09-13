/**
 * The instance's settings screens, in the order an administrator meets them.
 *
 * One list, read by two things that must agree: the left navigation, and the
 * redirect `/admin/settings` performs. Keeping them apart is how a renamed
 * section becomes a landing page that redirects to a route that no longer
 * exists.
 */
export const SETTINGS_SECTIONS = [
  { to: '/admin/settings/organisation', label: 'Organisation' },
  { to: '/admin/settings/theme', label: 'Theme' },
  { to: '/admin/settings/layout', label: 'Layout' },
  { to: '/admin/settings/secrets', label: 'Secrets and sign-in' },
] as const

/** Where `/admin/settings` itself goes: the first section, never a landing page. */
export const FIRST_SETTINGS_SECTION = SETTINGS_SECTIONS[0].to
