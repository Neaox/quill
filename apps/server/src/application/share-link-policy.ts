import type { ShareLinkPolicy } from '@quill/application'

import type { ServerConfig } from '../config.ts'

/**
 * Whether this organisation allows share links (plan section 14).
 *
 * The port is a function rather than a flag because the answer is about to
 * start coming from somewhere that changes while the server runs.
 *
 * TODO(M3): read the organisation's own setting once the settings store
 * lands — and with it the maximum role a link may carry — so that an
 * administrator can close the door from the interface rather than by
 * restarting with `SHARE_LINKS=off`. Nothing above this port changes when
 * that happens: it is asked on every creation and on every use, never cached.
 */
export function createShareLinkPolicy(config: Pick<ServerConfig, 'shareLinks'>): ShareLinkPolicy {
  return { allowed: () => config.shareLinks.enabled }
}
