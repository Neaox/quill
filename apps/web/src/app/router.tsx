import { createRouter, type RouterHistory } from '@tanstack/react-router'

import { ProgressBar } from '@quill/ui'

import { routeTree } from '../routeTree.gen.ts'
import type { RouterContext } from './router-context.ts'

export type { RouterContext }

/**
 * The router.
 *
 * Routes are **files**: everything under `src/routes` is compiled into
 * `src/routeTree.gen.ts` by `@tanstack/router-plugin` (configured in
 * `vite.config.ts`), which is generated, committed, and never edited by hand
 * (AGENTS.md rule 11a). Reading `src/routes` is reading the URL space.
 *
 * Four rules hold the tree together:
 *
 * 1. **Authentication is checked once**, in `_authenticated/route.tsx`'s
 *    `beforeLoad`. No page and no loader repeats it.
 * 2. **A shell is a layout route.** `_authenticated/w/$workspaceSlug/route.tsx`
 *    renders the top bar, the icon rail and the navigation sidebar once; the
 *    workspace home, every document, and the editor are children that render
 *    in its `<Outlet />`, and so do their pending, error and not-found states.
 *    Nothing below it builds chrome of its own. Presentation mode opts out
 *    with the `_` suffix, because the whole screen is the document.
 * 3. **Data is loaded by the route that needs it**, through the same query
 *    options its components use (`lib/api`'s `*QueryOptions` factories), so
 *    the first render already has it. A loader `await`s what the page cannot
 *    be drawn without and prefetches the rest.
 * 4. **URL state is search params** (ADR-013) — the revision being read, the
 *    two being compared, the step on the projector — validated by the route
 *    that owns it.
 *
 * Code splitting is the plugin's `autoCodeSplitting`, which gives every
 * route's component its own chunk while loaders stay in the critical path.
 *
 * `history` is a parameter so that a test can mount this exact router — these
 * options, this pending component, this scroll behaviour — over a memory
 * history (`lib/api/render-app.tsx`). A test that built its own `createRouter`
 * would be exercising a router the application never runs.
 */
export function createAppRouter(context: RouterContext, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context,
    ...(history === undefined ? {} : { history }),
    // A route's chunk and loader start on hover or focus of the link, so by
    // the time the click lands most of the wait is already over. The stale
    // time is zero because TanStack Query, not the router, owns freshness:
    // the loaders write into its cache and it decides when to refetch.
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: RoutePending,
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
    /*
     * Opening a document starts at its top, and the back button returns to
     * exactly where the previous page was left. Off by default in the router,
     * which is why a new document used to open at the offset the last one was
     * scrolled to.
     *
     * `scrollToTopSelectors` is deliberately not set: the shell's main column
     * does not scroll a container of its own — the window scrolls it
     * (`packages/ui/src/styles/components.css`), and the rail, the tree and
     * the aside scroll their own containers precisely so that they *keep*
     * their position while the document changes.
     */
    scrollRestoration: true,
  })
}

/**
 * What a route shows while its code or data is still on the way: a thin bar at
 * the top of the viewport, the page-level form of the pending vocabulary in
 * `docs/design/feedback.md`. The router only mounts it after `defaultPendingMs`,
 * so an instant navigation never flashes it, and keeps it for at least
 * `defaultPendingMinMs` once shown, so a slow one never flickers. Nothing else
 * moves: the page already on screen stays put until the next one is ready.
 */
export function RoutePending() {
  return <ProgressBar placement="top" label="Loading page" />
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
