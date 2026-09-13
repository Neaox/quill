import { HeadContent, Outlet, createRootRouteWithContext } from '@tanstack/react-router'

import { BRAND } from '@quill/brand'

import { RouteNotice } from '../features/workspaces/route-notice.tsx'
import type { RouterContext } from '../app/router-context.ts'

/**
 * The root of the file-based route tree (`src/routes`, generated into
 * `src/routeTree.gen.ts`).
 *
 * `HeadContent` renders whatever the deepest matched route's `head()` asked
 * for, which is how every page gets its own document title without any page
 * touching `document.title` itself.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({ meta: [{ title: BRAND.name }] }),
  notFoundComponent: () => (
    <RouteNotice
      title="We couldn't find that page"
      body="The address may be out of date, or the thing it pointed at may have been deleted."
      full
    />
  ),
  /*
   * The last resort for anything a route below did not catch. Without one the
   * router falls back to its own raw error screen — a stack trace on a white
   * page — which is neither this product's voice nor a way onwards. Routes
   * that can say something more specific still do; this is what a route with
   * no `errorComponent` of its own falls through to.
   */
  errorComponent: () => (
    <RouteNotice
      title="Something went wrong"
      body="The page could not be shown. Reload to try again; if it keeps happening, tell your administrator."
      full
    />
  ),
  component: RootLayout,
})

function RootLayout() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  )
}
