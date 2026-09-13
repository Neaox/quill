import { setSecret } from '@quill/application'
import type { SetSecretResult } from '@quill/application'
import type { UserId } from '@quill/domain'

import type { AppDependencies } from '../dependencies.ts'

/**
 * `pnpm --filter @quill/server secrets:set <name>` — how an administrator
 * enters a secret ADR-034 asks for: an OIDC client secret, an SMTP password,
 * a webhook signing key. The name is the only thing the environment or a
 * command line ever sees; the value is read from stdin (`secrets-set-cli.ts`)
 * and never appears in `argv`, where it would sit in shell history and in
 * this or any other process's list of running commands.
 *
 * A script rather than a settings-screen button because it is what this
 * migration needs first: an operator moving `OIDC_<ID>_CLIENT_SECRET` and
 * `SMTP_PASS` out of the environment, once, before the fallback that reads
 * them is removed in a later release.
 */

export interface SetSecretOutput {
  (line: string): void
}

/** What `secrets-set-cli.ts` uses to choose its exit code. */
export type SetSecretOutcome = SetSecretResult['kind']

export async function setSecretValue(
  deps: AppDependencies,
  name: string,
  value: string,
  actor: UserId,
  write: SetSecretOutput,
): Promise<SetSecretOutcome> {
  const result = await setSecret(deps, { name, value, actor })
  switch (result.kind) {
    case 'set':
      write(`Set secret "${name}" (key ${result.secret.keyId}).`)
      break
    case 'invalid-name':
      write(
        `"${name}" is not a valid secret name: lower-case, path-like segments such as ` +
          '"oidc/entra/client-secret" (see SECRET_NAME_PATTERN).',
      )
      break
    case 'invalid-value':
      write(
        result.reason === 'empty'
          ? 'The value read from stdin was empty; nothing was stored.'
          : 'The value read from stdin is too long; nothing was stored.',
      )
      break
  }
  return result.kind
}
