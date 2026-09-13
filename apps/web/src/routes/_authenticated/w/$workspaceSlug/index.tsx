import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceHomePage } from '../../../../features/workspaces/workspace-home-page.tsx'

/**
 * The workspace's own front page, inside the shell the layout beside this file
 * renders. An index route, so `/w/<workspace>` is the layout plus this and
 * nothing else has to know it is the default.
 *
 * No loader of its own: the workspace and its tree are already in the cache
 * from the layout's, and this page reads them from there.
 */
export const Route = createFileRoute('/_authenticated/w/$workspaceSlug/')({
  component: WorkspaceHomePage,
})
