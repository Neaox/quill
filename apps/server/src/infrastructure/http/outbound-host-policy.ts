import type { OutboundHostPolicy, OutboundHostVerdict } from '@quill/application'

import { resolvePublicAddresses, resolveWithDns } from './outbound-client.ts'
import type { ResolveHost } from './outbound-client.ts'

/**
 * ADR-011's address check, for a request this process does not send itself:
 * the `git` CLI fetching an external source (ADR-061).
 *
 * The host must resolve, and only to public addresses, unless the operator
 * has vouched for it by name: a self-hosted Git server on the private network
 * is a real case. Unlike the outbound client, nothing can pin the connection
 * to the checked address, because `git` resolves the name again; an instance
 * that must rule out DNS rebinding sets an egress proxy that applies the same
 * rules.
 */

export interface OutboundHostPolicyOptions {
  /** Exact host names that may resolve to private addresses. */
  readonly privateHostsAllowed?: readonly string[]
  readonly resolve?: ResolveHost
}

export function createOutboundHostPolicy(options: OutboundHostPolicyOptions): OutboundHostPolicy {
  const vouchedFor = new Set(options.privateHostsAllowed?.map((host) => host.toLowerCase()))
  const resolve = options.resolve ?? resolveWithDns

  return {
    async check(url: URL): Promise<OutboundHostVerdict> {
      // `URL` keeps the brackets around an IPv6 address; the resolver wants the address.
      const hostname = url.hostname.replace(/^\[(.*)\]$/u, '$1').toLowerCase()
      if (vouchedFor.has(hostname)) return { allowed: true }
      try {
        await resolvePublicAddresses(hostname, resolve)
      } catch (error) {
        return { allowed: false, reason: String(error) }
      }
      return { allowed: true }
    },
  }
}
