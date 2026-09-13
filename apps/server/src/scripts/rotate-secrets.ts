import { rotateMasterKey } from '@quill/application'
import type { UserId } from '@quill/domain'

import type { AppDependencies } from '../dependencies.ts'

/**
 * Re-wrap every secret's data key with the current master key (ADR-034).
 *
 * The operator procedure this exists for: put the new key in
 * `QUILL_MASTER_KEY`, move the old one into `QUILL_MASTER_KEY_PREVIOUS`,
 * restart, run this, then drop the old key. Nothing is decrypted and
 * re-encrypted — the data keys move, the ciphertexts do not — so it costs the
 * same whatever the secrets are, and it is safe to run twice: a secret already
 * on the current key is not in the query.
 *
 * It is a script rather than a route because it is an operator's action tied
 * to an environment change, on an instance that has just been restarted with
 * a key it did not have before. A button in a settings screen could not say
 * which key it was rotating to.
 */

/** Somewhere for the report to go. `process.stdout.write` in the CLI. */
export interface RotationOutput {
  (line: string): void
}

export interface RotateSecretsResult {
  readonly rewrapped: number
  readonly unreadable: readonly string[]
  readonly keyId: string
}

/**
 * The rotation is attributed to no user: `actor` is the instance
 * administrator an operator names, or null when nobody was at a keyboard.
 * The audit row records the key id either way.
 */
export async function rotateSecrets(
  deps: AppDependencies,
  actor: UserId,
  write: RotationOutput,
): Promise<RotateSecretsResult> {
  const result = await rotateMasterKey(deps, actor)
  write(`Re-wrapped ${result.rewrapped} secret(s) onto master key ${result.keyId}.`)
  if (result.unreadable.length > 0) {
    write(
      `Could not re-wrap ${result.unreadable.length} secret(s): no available master key opens ` +
        `them, so they have to be entered again. ${result.unreadable.join(', ')}`,
    )
  }
  return result
}
