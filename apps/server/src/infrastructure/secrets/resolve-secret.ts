import { getSecret } from '@quill/application'
import type { SecretsDependencies } from '@quill/application'

/**
 * Resolving a secret an administrator might have entered in the product, or
 * might still be naming through an environment variable for one release
 * (ADR-011's OIDC client secret, ADR-034's SMTP password).
 *
 * The rule is the same for both: the secrets store wins when it holds the
 * name; the environment variable is a fallback, read verbatim, for as long as
 * an administrator has not entered the secret; and the fallback's use is
 * warned about once, at boot (`boot-validation.ts`), never on every call —
 * this module is reached from the token exchange and from every mail send,
 * and a warning on each of those would drown the log it is meant to inform.
 */

export interface SecretFallback {
  /** The name the secret is stored under, or would be, in the secrets store. */
  readonly name: string
  /** The environment variable this falls back to, named only for error messages. */
  readonly envVarName: string
  /** The variable's value at boot, or `undefined` when it was never set. */
  readonly envValue: string | undefined
}

export type ResolvedSecret =
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false
      /** The row exists but a master key that once wrapped it is gone. */
      readonly reason: 'not-found' | 'unreadable'
    }

export interface SecretResolver {
  resolve(fallback: SecretFallback): Promise<ResolvedSecret>
}

/**
 * The one resolver every process builds once, over whichever `SecretCipher`
 * and `UnitOfWork` the composition root already has (`main.ts`,
 * `rotate-secrets-cli.ts`, `test-support/harness.ts`).
 */
export function createSecretResolver(deps: SecretsDependencies): SecretResolver {
  return {
    async resolve(fallback: SecretFallback): Promise<ResolvedSecret> {
      const found = await getSecret(deps, fallback.name)
      if (found.kind === 'secret') return { ok: true, value: found.value }
      if (found.kind === 'unreadable') return { ok: false, reason: 'unreadable' }
      if (fallback.envValue !== undefined && fallback.envValue.length > 0) {
        return { ok: true, value: fallback.envValue }
      }
      return { ok: false, reason: 'not-found' }
    },
  }
}
