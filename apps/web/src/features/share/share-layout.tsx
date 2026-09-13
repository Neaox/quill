import { Outlet, getRouteApi } from '@tanstack/react-router'

import { useLoadedSharedDocument } from '../../lib/api/index.ts'
import { ShareChrome } from './share-chrome.tsx'

const routeApi = getRouteApi('/share/$token')

/**
 * The share-link surface's own layout route: the minimal chrome, rendered
 * once, with the target document and every document inside a subtree link
 * rendering into it.
 *
 * It reads the link from the query the route's loader already awaited rather
 * than from the loader's return value, so the target and each child page are
 * looking at exactly one resolution of one token — one request, one audited
 * use — however many pages a reader moves between.
 */
export function ShareLayout() {
  const { token } = routeApi.useParams()
  const shared = useLoadedSharedDocument(token).data

  return (
    <ShareChrome link={shared.link}>
      <Outlet />
    </ShareChrome>
  )
}
