import { createOutboundClient, nodeFetch } from '../../infrastructure/http/outbound-client.ts'
import type { OutboundClientFactory } from './discovery.ts'

/**
 * Lets the OIDC identity-provider registry reach a provider that is really
 * listening on loopback — the in-process fake `test-support/fake-oidc-provider.ts`
 * started for `e2e/sso.spec.ts`, or the same fake run by hand for local
 * testing — despite the SSRF-safe outbound client's blanket refusal of
 * loopback and private addresses (`infrastructure/http/outbound-client.ts`),
 * which is correct for every provider that is not this one and is completely
 * untouched by this module: the allowlist itself, the redirect cap, the
 * timeout and the size cap all still apply, on the real transport
 * (`nodeFetch`). What moves is only where an allowed hostname is permitted to
 * resolve to.
 *
 * `main.ts` only ever builds this when `ServerConfig.oidcDevLoopback` is
 * true, which `config.ts` refuses to set once `APP_URL` names anything but
 * loopback — so this code never runs in a real deployment, whatever an
 * operator sets by mistake, in the same "convenience that hard-refuses
 * outside development" shape as `DEVELOPMENT_MASTER_KEY` and `MAIL_DRIVER=dev`.
 *
 * The technique is exactly `fake-oidc-provider.ts`'s own `createClient`,
 * generalised: `resolve` reports a public test address (RFC 5737 TEST-NET-3,
 * never routed) so the SSRF check's "is this address private" test passes,
 * and `fetch` then dials `127.0.0.1` on the port the URL already named —
 * the fake provider's own port, whatever it is — rather than the address
 * `resolve` reported. TLS is never involved: every provider this ever talks
 * to is `http:` on loopback.
 */

/** RFC 5737 TEST-NET-3: never routed, and public as far as the SSRF checks are concerned. */
const PUBLIC_TEST_ADDRESS = '203.0.113.7'

export function createDevLoopbackOutboundClientFactory(): OutboundClientFactory {
  return (allowedHosts) =>
    createOutboundClient({
      allowedHosts,
      resolve: async () => [PUBLIC_TEST_ADDRESS],
      fetch: async (url, init) => {
        const target = new URL(url)
        target.hostname = '127.0.0.1'
        return nodeFetch(target.href, { ...init, addresses: ['127.0.0.1'] })
      },
    })
}
