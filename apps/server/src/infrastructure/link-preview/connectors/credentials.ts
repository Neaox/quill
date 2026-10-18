import { getSecret } from '@quill/application'
import type { ConnectorCredentialSource, SecretsDependencies } from '@quill/application'

/**
 * Where a connector's credentials come from (ADR-034, ADR-042): the secrets store, under
 * the name the connector declares, entered by an administrator on the secrets screen or
 * with `secrets:set`. The ciphertext is opened at the moment a connector is about to ask
 * its API and the value is not kept, so rotating the secret takes effect on the next
 * request and the token never sits in a long-lived object.
 *
 * A secret that is absent, or that no available master key opens, is answered as "none".
 * The connector then acts anonymously: public content still previews, at GitHub's lower
 * anonymous rate limit, and a broken credential degrades a preview rather than failing it.
 */
export function createConnectorCredentialSource(
  deps: SecretsDependencies,
): ConnectorCredentialSource {
  return {
    async forConnector(connector) {
      const found = await getSecret(deps, connector.secretName)
      return found.kind === 'secret' ? { token: found.value } : null
    },
  }
}
