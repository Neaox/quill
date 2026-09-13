import { BRAND } from '@quill/brand'

import { DEFAULT_THEME, recommendedLayout } from '@quill/theme/builtin'

import type { OrganisationSettings } from '../../lib/api/index.ts'

/**
 * The organisation settings an instance starts with.
 *
 * The server answers `GET /settings/organisation` with exactly this when
 * nothing has been saved, so no screen normally needs it. It is here for the
 * one case where the server *cannot* answer: a settings file written by a
 * newer release, which this release refuses to read rather than overwrite
 * (ADR-034). The repair path writes a document, and an administrator is shown
 * which one before it is written, so it has to exist on this side too.
 *
 * It is deliberately the same shape as `defaultOrganisationSettings` in
 * `@quill/application` rather than a call to it: the web app talks to the
 * server through the generated client only, and the type above comes from
 * that client, so the two are held together by the schema rather than by an
 * import the layering forbids.
 *
 * The one line that would otherwise drift is the layout, which ADR-028's
 * amendment renames: both sides call `recommendedLayout` from
 * `@quill/theme/builtin`, so the rename lands in one place and this copy
 * follows it rather than being a second caller the rename will not touch.
 */
export function defaultOrganisationSettings(): OrganisationSettings {
  return {
    version: 1,
    name: BRAND.name,
    theme: DEFAULT_THEME,
    layout: { default: recommendedLayout(DEFAULT_THEME), locked: false },
    publicNavigation: [],
    policies: {
      shareLinksAllowed: true,
      publicPublishingAllowed: false,
      contrastEnforcement: 'enforced',
    },
  }
}
