import { getRouteApi } from '@tanstack/react-router'

import { useLoadedSharedDocument } from '../../lib/api/index.ts'
import { SharedDocumentView } from './shared-document-view.tsx'

const routeApi = getRouteApi('/share/$token/')

/**
 * The document a link was made for.
 *
 * Everything it needs — the link's terms, the document, the published body,
 * and the navigation a subtree link carries — arrives in the one response
 * `GET /api/share/:token` answers, so this page makes no request of its own
 * and there is nothing here to wait for.
 */
export function SharePage() {
  const { token } = routeApi.useParams()
  const shared = useLoadedSharedDocument(token).data

  return (
    <SharedDocumentView
      token={token}
      title={shared.document.title}
      html={shared.rendered.html}
      revision={shared.rendered.revision}
      outline={shared.rendered.outline}
      target={shared.document}
      navigation={shared.children}
    />
  )
}
