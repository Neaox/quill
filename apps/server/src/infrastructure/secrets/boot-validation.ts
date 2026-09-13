import { describeSecret } from '@quill/application'
import type { SecretsDependencies } from '@quill/application'

import { BRAND } from '@quill/brand'

/**
 * "Does something name a value for this secret" — checked once, at boot,
 * before the server starts listening (ADR-011, ADR-034), the same way a
 * misconfigured OIDC provider or a missing master key is a boot failure
 * rather than a button that fails when somebody presses it.
 *
 * `describeSecret` only, never `getSecret`: this is an existence check, not a
 * read, so a secret's ciphertext is never opened just to decide whether the
 * server may start.
 */

export interface SecretExistenceCheck {
  /** The secret name the store is checked for. */
  readonly name: string
  /** The environment variable this falls back to, for one release. */
  readonly envVarName: string
  readonly envValue: string | undefined
  /** What the secret is, for the boot failure and the deprecation warning: "the SMTP password". */
  readonly description: string
}

export interface BootWarn {
  (message: string): void
}

/**
 * Refuses to start when a configured secret names no value anywhere, and
 * warns once, naming the secret to set, when a check only passes because of
 * its environment fallback.
 */
export async function validateSecretsConfigured(
  deps: SecretsDependencies,
  checks: readonly SecretExistenceCheck[],
  warn: BootWarn,
): Promise<void> {
  for (const check of checks) {
    const found = await describeSecret(deps, check.name)
    if (found.kind === 'secret') continue

    if (check.envValue !== undefined && check.envValue.length > 0) {
      warn(
        `${check.envVarName} is deprecated: set ${check.description} as a secret instead of an ` +
          `environment variable (\`${BRAND.slug} secrets:set ${check.name}\`, reading the value ` +
          `from stdin). Reading ${check.envVarName} will stop being supported in a future release.`,
      )
      continue
    }

    throw new Error(
      `${check.description} is not configured: set it with ` +
        `\`${BRAND.slug} secrets:set ${check.name}\` (the value is read from stdin, never ` +
        `printed back) or, for now, ${check.envVarName}.`,
    )
  }
}
