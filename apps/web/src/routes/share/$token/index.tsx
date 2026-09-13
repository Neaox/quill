import { createFileRoute } from '@tanstack/react-router'

import { SharePage } from '../../../features/share/share-page.tsx'

/**
 * The link's own target. Its data was awaited by the layout route above —
 * one token, one resolution, one audited use — so this route has no loader of
 * its own and nothing to wait for.
 */
export const Route = createFileRoute('/share/$token/')({
  component: SharePage,
})
