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
 *
 * `SecretFallback` names the environment variable rather than carrying its
 * value: the value is read from `env` fresh on every call, not snapshotted
 * onto `ServerConfig` at boot, so it never sits on an object reachable from
 * every route handler for the length of the deprecation window, and so a
 * rotated environment variable takes effect without a restart the same way
 * the secrets-store path already does.
 */

export interface SecretFallback {
  /** The name the secret is stored under, or would be, in the secrets store. */
  readonly name: string
  /** The environment variable this falls back to — read at the moment of use, never stored. */
  readonly envVarName: string
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
 *
 * `env` defaults to `process.env` and is a parameter only so a test can
 * supply one without mutating the real environment.
 */
export function createSecretResolver(
  deps: SecretsDependencies,
  env: NodeJS.ProcessEnv = process.env,
): SecretResolver {
  return {
    async resolve(fallback: SecretFallback): Promise<ResolvedSecret> {
      const found = await getSecret(deps, fallback.name)
      if (found.kind === 'secret') return { ok: true, value: found.value }
      if (found.kind === 'unreadable') return { ok: false, reason: 'unreadable' }
      const envValue = env[fallback.envVarName]
      if (envValue !== undefined && envValue.length > 0) {
        return { ok: true, value: envValue }
      }
      return { ok: false, reason: 'not-found' }
    },
  }
}
