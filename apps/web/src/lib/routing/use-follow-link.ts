import { useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'

/**
 * Follows an in-application address a rendered body links to, through the
 * router rather than a page load (`DocumentBody`'s `onFollowLink`).
 *
 * The address arrives whole — path, query and section — because it is the
 * author's, written in the body, not a route this code chose; the router
 * matches it like any other, so `/d/<id>` resolves and canonicalises exactly
 * as it does when the same link is opened in a new tab.
 */
export function useFollowLink(): (href: string) => void {
  const router = useRouter()
  return useCallback(
    (href: string) => {
      void router.navigate({ href })
    },
    [router],
  )
}
