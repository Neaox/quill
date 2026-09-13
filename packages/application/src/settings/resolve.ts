import type { ThemeDocument } from '@quill/theme'

import type { Layout } from './layout.ts'
import type { OrganisationLogo, OrganisationSettings, WorkspaceSettings } from './documents.ts'

/**
 * The effective settings for one workspace, resolved down ADR-028's
 * "who decides what" table.
 *
 * The table gives each setting exactly one owner and says the others inherit.
 * Identity — the theme — is the organisation's and a workspace may not change
 * it, so it is copied down unchanged. Layout is the workspace's, with an
 * organisation default the workspace inherits until it says otherwise, and
 * which the organisation may lock. Policies are the organisation's.
 *
 * The third column of that table, the person, is deliberately absent: colour
 * scheme, text size, reduced motion, and high contrast belong to the reader
 * and are applied in the browser, over whatever this returns. Nothing here
 * can remove them.
 */
export interface EffectiveSettings {
  readonly theme: ThemeDocument
  /**
   * How strictly the theme doctor reports on this organisation (ADR-028).
   * Lifted out of `policies` because it belongs beside the theme wherever a
   * report is shown, and a caller should not have to know where it is kept.
   */
  readonly contrastEnforcement: 'enforced' | 'advisory'
  readonly layout: Layout
  /** Why the layout is what it is, so a settings screen can say so. */
  readonly layoutSource: 'workspace' | 'organisation'
  readonly layoutLocked: boolean
  readonly policies: OrganisationSettings['policies']
  readonly publicNavigation: OrganisationSettings['publicNavigation']
  readonly organisationName: string
  readonly logo?: OrganisationLogo
}

export function resolveEffectiveSettings(
  organisation: OrganisationSettings,
  workspace: WorkspaceSettings | null,
): EffectiveSettings {
  const override = organisation.layout.locked ? undefined : workspace?.layout
  return {
    theme: organisation.theme,
    contrastEnforcement: organisation.policies.contrastEnforcement,
    layout: override ?? organisation.layout.default,
    layoutSource: override === undefined ? 'organisation' : 'workspace',
    layoutLocked: organisation.layout.locked,
    policies: organisation.policies,
    publicNavigation: organisation.publicNavigation,
    organisationName: organisation.name,
    ...(organisation.logo === undefined ? {} : { logo: organisation.logo }),
  }
}
