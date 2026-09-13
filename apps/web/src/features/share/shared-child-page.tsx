import { getRouteApi } from '@tanstack/react-router'

import { useLoadedSharedBody, useLoadedSharedDocument } from '../../lib/api/index.ts'
import { SharedDocumentView } from './shared-document-view.tsx'

const routeApi = getRouteApi('/share/$token/d/$documentRef/')

/**
 * A document inside a subtree link.
 *
 * Two cached entries, and neither is fetched again here: the link's own
 * response supplies the navigation and the target it is rooted at, and this
 * route's loader supplied the body. The scope is resolved by the server on
 * every request against the tree as it is *now*, so a document moved out from
 * under the link's target is refused at the loader and this never renders —
 * which is why nothing in this component checks whether the document it was
 * handed is one the navigation lists.
 */
export function SharedChildPage() {
  const { token, documentRef } = routeApi.useParams()
  const shared = useLoadedSharedDocument(token).data
  const body = useLoadedSharedBody(token, documentRef).data

  return (
    <SharedDocumentView
      token={token}
      title={body.document.title}
      html={body.rendered.html}
      revision={body.rendered.revision}
      outline={body.rendered.outline}
      target={shared.document}
      navigation={shared.children}
    />
  )
}
