import { useEffect, useRef } from 'react'

/**
 * Fires a single-use mutation exactly once for the token a route was entered
 * with (a magic-link consume, an email verification). The token arriving in
 * the URL is the external system the effect synchronises with (ADR-013); the
 * ref guards a single-use token against being consumed twice under React's
 * development-mode double-invoke, which would otherwise surface as a
 * confusing "link already used" error on the very first visit.
 */
export function useConsumeOnMount(token: string, mutate: (token: string) => void): void {
  const attempted = useRef(false)

  // Synchronises with the server: a one-shot token is spent exactly once,
  // whatever React's development-mode double-invoke does to this effect.
  useEffect(() => {
    if (attempted.current) return
    attempted.current = true
    mutate(token)
  }, [token, mutate])
}
