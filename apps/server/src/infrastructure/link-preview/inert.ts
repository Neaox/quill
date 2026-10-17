import type { LinkPreviewPorts } from '@quill/application'
import { compileLinkPolicy, err } from '@quill/domain'

/**
 * Link previews that are off, for a process that has no business fetching
 * (ADR-042): a maintenance script that builds the application dependencies it
 * does not use, and tests of everything else.
 *
 * Every link reads as `blocked`, nothing is ever queued or fetched, and a
 * refresh is refused. It is the policy `off` made into an object, so the code
 * that handles an organisation with previews off is the code that runs here.
 */
const off = compileLinkPolicy({ mode: 'off', allow: [], block: [] })
/* v8 ignore next -- an empty policy always compiles. */
if (!off.ok) throw new Error('The inert link preview policy did not compile')

const inertAudience = { scope: 'inert', policy: off.value }

export const INERT_LINK_PREVIEW_PORTS: LinkPreviewPorts = {
  audiences: { forPerson: async () => inertAudience, forPublic: async () => inertAudience },
  resolver: { resolve: async () => err('blocked') },
  limits: {
    allowFetch: () => ({ allowed: false, retryAfterMs: 60_000 }),
    allowRefresh: () => false,
    allowRead: () => false,
    allowQueued: () => 0,
  },
}
