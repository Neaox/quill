import { Resolver } from 'node:dns/promises'
import { isIP } from 'node:net'

import type { ResolveHost } from './outbound-client.ts'

/**
 * Name resolution for the open web (ADR-042).
 *
 * The allowlisted client resolves with `getaddrinfo`, which Node runs on its
 * four-thread libuv pool, the same pool that serves file reads, `crypto` and
 * `zlib` for the whole server. That is fine for a handful of vetted names. It
 * is not for hostnames strangers choose: a domain whose nameserver answers
 * slowly on purpose holds a pool thread until the resolver gives up, and four
 * such lookups stall every file read in the process.
 *
 * So this resolver uses c-ares (`dns.Resolver`), which does its own
 * non-blocking network I/O and takes no pool thread, with a short timeout. It
 * asks for both families and keeps every answer; the caller refuses the host
 * if any one of them is not public.
 *
 * The cost is that c-ares does not read the hosts file, so `localhost` and
 * other local names do not resolve here. That is the safe direction: they were
 * never to be reached, and now they fail as "did not resolve".
 */

const DNS_TIMEOUT_MS = 2_000
const DNS_TRIES = 2

/** The two queries this module makes; a test supplies its own. */
export interface DnsAnswers {
  resolve4(hostname: string): Promise<string[]>
  resolve6(hostname: string): Promise<string[]>
}

function unbracketed(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

export function createOpenWebResolver(
  dns: DnsAnswers = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES }),
): ResolveHost {
  return async (hostname) => {
    // A URL's host for an IPv6 literal keeps its brackets, and neither form needs a lookup.
    const literal = unbracketed(hostname)
    if (isIP(literal) !== 0) return [literal]

    const [v4, v6] = await Promise.allSettled([dns.resolve4(literal), dns.resolve6(literal)])
    const addresses = [v4, v6].flatMap((answer) =>
      answer.status === 'fulfilled' ? answer.value : [],
    )
    if (addresses.length === 0) throw new Error(`${hostname} has no address records`)
    return addresses
  }
}
