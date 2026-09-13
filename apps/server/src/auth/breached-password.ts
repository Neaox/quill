import { createHash } from 'node:crypto'

import type { OutboundReader } from '../infrastructure/http/outbound-client.ts'
import { isLocallyKnownBreached } from './breached-password-corpus.ts'

/**
 * "Has this password already been in a breach?" (ADR-011, NIST 800-63B).
 *
 * The port is deliberately three-valued. A corpus that cannot be reached is
 * not the same as a password that is clean, and the platform must not lock
 * people out of signing up because a third party is down — so callers fail
 * open and write an audit event, which is the only way anyone finds out the
 * check has been silently absent for a week.
 */

export type BreachedPasswordResult =
  | { readonly status: 'ok' }
  | { readonly status: 'breached'; readonly count: number }
  | { readonly status: 'unavailable'; readonly reason: string }

export interface BreachedPasswordChecker {
  check(password: string): Promise<BreachedPasswordResult>
}

/** Never asks: for an instance that has deliberately turned the check off. */
export function createDisabledBreachedPasswordChecker(): BreachedPasswordChecker {
  return {
    async check(): Promise<BreachedPasswordResult> {
      return { status: 'unavailable', reason: 'disabled' }
    },
  }
}

/**
 * The bundled corpus behind whichever checker is configured (ADR-011,
 * review finding M10).
 *
 * Wrapping rather than replacing, because the two answer different
 * questions. The remote corpus knows half a billion passwords and is the
 * real check; the local one knows a few thousand and exists for the moments
 * the remote cannot be reached — an air-gapped instance, a provider outage,
 * a proxy that has stopped working. Before this, those moments meant no
 * check at all, and `password1234` sailed through.
 *
 * Only an `unavailable` verdict reaches the local list: a remote `ok` is
 * better evidence than anything here, and a remote `breached` is already the
 * answer. An `unavailable` that the local list cannot refuse stays
 * `unavailable`, so the audit event that makes the gap visible still fires.
 */
export function withLocalFallback(remote: BreachedPasswordChecker): BreachedPasswordChecker {
  return {
    async check(password: string): Promise<BreachedPasswordResult> {
      const verdict = await remote.check(password)
      if (verdict.status !== 'unavailable') return verdict
      return isLocallyKnownBreached(password)
        ? { status: 'breached', count: 0 }
        : { status: 'unavailable', reason: verdict.reason }
    },
  }
}

export interface HibpCheckerOptions {
  /** Only ever reads, so it asks for the read half (`OutboundReader`). */
  readonly client: OutboundReader
  /** The range endpoint; the password's SHA-1 prefix is appended to it. */
  readonly rangeApiUrl: string
}

const PREFIX_LENGTH = 5

/**
 * The k-anonymity range API: only the first five hex characters of the
 * password's SHA-1 ever leave the instance, and the suffix is matched
 * locally, so the service never learns which password was asked about.
 */
export function createHibpBreachedPasswordChecker(
  options: HibpCheckerOptions,
): BreachedPasswordChecker {
  return {
    async check(password: string): Promise<BreachedPasswordResult> {
      const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
      const prefix = digest.slice(0, PREFIX_LENGTH)
      const suffix = digest.slice(PREFIX_LENGTH)

      let body: string
      try {
        const response = await options.client.get({
          url: `${options.rangeApiUrl}/${prefix}`,
          headers: { 'Add-Padding': 'true' },
        })
        if (response.status !== 200) {
          return { status: 'unavailable', reason: `status_${response.status}` }
        }
        body = response.body
      } catch (error) {
        return {
          status: 'unavailable',
          reason: error instanceof Error ? error.name : 'network_error',
        }
      }

      for (const line of body.split('\n')) {
        const [candidate, count] = line.trim().split(':')
        if (candidate === suffix) {
          // The padded responses the API adds carry a count of 0; those are
          // decoys, not hits.
          const times = Number(count ?? '0')
          if (times > 0) return { status: 'breached', count: times }
        }
      }
      return { status: 'ok' }
    },
  }
}
