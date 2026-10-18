import { useQueries } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { EMBED_PROVIDERS } from '@quill/domain'
import type { EditorLinkPreview, LinkPreviewSource, LinkRefreshOutcome } from '@quill/editor'

import {
  ApiError,
  linkPreviewImageUrl,
  linkPreviewQueryOptions,
  useApiClient,
  useOrganisationSettings,
  useRefreshLinkPreview,
} from '../../lib/api/index.ts'
import type { LinkPreview, LinkPreviewView } from '../../lib/api/index.ts'
import { linkSettingsOf } from '../settings/link-settings-model.ts'

/** How a refused or failed refresh reads to the author: quietly, and never as an error in the page. */
function refreshOutcome(error: unknown): LinkRefreshOutcome {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'rate_limited'
    if (error.status === 403) return 'blocked'
  }
  return 'failed'
}

/**
 * How the editor gets the preview of a link, and what the organisation has
 * decided about links (ADR-042).
 *
 * A card or the link toolbar says which address it is showing (`request`), and
 * this asks the server for each address once, through the same cached read the
 * reader's peek uses, so a page looked at while writing is already stored by the
 * time it is read. Only a preview that is ready is handed back as one; a link
 * that is still being fetched, blocked or unavailable is drawn from its address,
 * never as an error, and `state` says which of those it is for the toolbar's
 * status line.
 *
 * `refresh` forces a fresh fetch and answers how it went in a word, never by
 * throwing: a refresh that is rate-limited or refused is a quiet sentence in the
 * toolbar. The organisation's default display and whether previews reach the
 * public site come from its settings; until those have loaded the editor claims
 * neither.
 */
/**
 * What the editor is given of a preview: the frame's address stays here, and the editor gets
 * the provider's name and shape, which is all it needs to offer `Embed` and to hold the place.
 */
function forEditor(preview: LinkPreview): EditorLinkPreview {
  const { embed, ...rest } = preview
  if (embed === undefined) return rest
  const name = EMBED_PROVIDERS.find((provider) => provider.id === embed.provider)?.name
  return { ...rest, embed: { provider: name ?? embed.provider, aspectRatio: embed.aspectRatio } }
}

export function useEditorLinkPreviews(): LinkPreviewSource {
  const client = useApiClient()
  const [wanted, setWanted] = useState<readonly string[]>([])
  const request = useCallback((url: string) => {
    setWanted((current) => (current.includes(url) ? current : [...current, url]))
  }, [])

  const views = useQueries({
    queries: wanted.map((url) => linkPreviewQueryOptions(client, url)),
    combine: (results) =>
      new Map(
        results.flatMap((result, index) => {
          const url = wanted[index]
          return result.data !== undefined && url !== undefined ? [[url, result.data] as const] : []
        }),
      ),
  })

  const refreshing = useRefreshLinkPreview()
  const { mutateAsync } = refreshing
  const refresh = useCallback(
    async (url: string): Promise<LinkRefreshOutcome> => {
      try {
        await mutateAsync(url)
        return 'started'
      } catch (error) {
        return refreshOutcome(error)
      }
    },
    [mutateAsync],
  )

  const settings = useOrganisationSettings().data?.settings
  const links = settings === undefined ? undefined : linkSettingsOf(settings)

  return useMemo(
    () => ({
      preview: (url) => readyPreview(views.get(url)),
      request,
      imageUrl: linkPreviewImageUrl,
      state: (url) => views.get(url)?.state ?? null,
      refresh,
      refreshing: refreshing.isPending,
      defaultDisplay: links?.defaultDisplay,
      publicSite: links?.publicSite,
    }),
    [views, request, refresh, refreshing.isPending, links?.defaultDisplay, links?.publicSite],
  )
}

function readyPreview(view: LinkPreviewView | undefined): EditorLinkPreview | null {
  return view?.state === 'ready' ? forEditor(view.preview) : null
}
