import {
  DEFAULT_LINK_PREVIEW_SETTINGS,
  linkPolicyOf,
  resolveLinkPreviewSettings,
} from '@quill/application'
import type { LinkPreviewSettings, Settings } from '@quill/application'
import type { LinkDisplay, LinkPreviewPolicy } from '@quill/domain'

/**
 * The organisation's link settings (ADR-042, "Policy"), read where a request
 * needs them: the policy Quill's fetches are held to, whether the public site
 * draws previews at all, and what a link looks like when its author chose
 * nothing.
 *
 * Read from the settings file each time rather than remembered, so a change an
 * administrator saves is in force on the next request in every process. It is
 * one small file read, and a policy that took effect "soon" would be a block
 * list that did not block.
 */

/** What an unreadable settings file means for links: no previews anywhere. Failing closed, never open. */
const CLOSED: LinkPreviewSettings = {
  ...DEFAULT_LINK_PREVIEW_SETTINGS,
  mode: 'off',
  publicSite: false,
}

export async function readLinkPreviewSettings(
  settings: Pick<Settings, 'readOrganisation'>,
): Promise<LinkPreviewSettings> {
  const read = await settings.readOrganisation()
  switch (read.kind) {
    case 'settings':
      return resolveLinkPreviewSettings(read.document)
    case 'unset':
      return DEFAULT_LINK_PREVIEW_SETTINGS
    case 'unreadable':
      return CLOSED
  }
}

/** What members' fetches and reads are held to. */
export async function linkSettingsPolicy(
  settings: Pick<Settings, 'readOrganisation'>,
): Promise<LinkPreviewPolicy> {
  return linkPolicyOf(await readLinkPreviewSettings(settings))
}

const NOTHING: LinkPreviewPolicy = { mode: 'off', allow: [], block: [] }

/** What the public site, share links and exports may draw: nothing, when the organisation said so. */
export async function linkPublicPolicy(
  settings: Pick<Settings, 'readOrganisation'>,
): Promise<LinkPreviewPolicy> {
  const read = await readLinkPreviewSettings(settings)
  return read.publicSite ? linkPolicyOf(read) : NOTHING
}

/** How a link whose author chose no display is drawn. */
export async function linkDefaultDisplay(
  settings: Pick<Settings, 'readOrganisation'>,
): Promise<LinkDisplay> {
  return (await readLinkPreviewSettings(settings)).defaultDisplay
}
