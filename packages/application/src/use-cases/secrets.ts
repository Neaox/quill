import type { UserId } from '@quill/domain'

import type { UnitOfWork } from '../ports/persistence.ts'
import type { SecretCipher, SecretCursor, SecretRow, SecretSummary } from '../ports/secrets.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { SECRET_NAME_PATTERN } from '../settings/documents.ts'

/**
 * Secrets entered in the product (ADR-034).
 *
 * Four rules hold across every use case here, and the tests state each of
 * them: a value goes in and never comes back out of a listing or an API; the
 * audit trail records the name and the key id and never the value; the
 * ciphertext is opened only at the moment of use; and the master key is
 * changed by re-wrapping data keys, never by re-encrypting secrets.
 */

export const SECRET_AUDIT_EVENTS = {
  set: 'secret.set',
  deleted: 'secret.deleted',
  masterKeyRotated: 'secret.master_key_rotated',
} as const

export interface SecretsDependencies {
  readonly uow: UnitOfWork
  readonly secrets: SecretCipher
  readonly clock: Clock
  readonly ids: IdGenerator
}

const NAME = new RegExp(SECRET_NAME_PATTERN)
export const MAX_SECRET_NAME_LENGTH = 200
export const MAX_SECRET_VALUE_LENGTH = 8192

export function isSecretName(name: string): boolean {
  return name.length <= MAX_SECRET_NAME_LENGTH && NAME.test(name)
}

export interface SetSecretCommand {
  readonly name: string
  readonly value: string
  readonly actor: UserId
}

export type SetSecretResult =
  | { readonly kind: 'set'; readonly secret: SecretSummary }
  | { readonly kind: 'invalid-name' }
  | { readonly kind: 'invalid-value'; readonly reason: 'empty' | 'too-long' }

/**
 * Store a secret, replacing any value already under that name.
 *
 * Replacing rather than refusing is deliberate: the operation an
 * administrator actually performs is "here is the current client secret", and
 * that is the same action whether or not one was there before. Nothing can
 * read the old value back afterwards, which is the point of rotating it.
 */
export async function setSecret(
  deps: SecretsDependencies,
  command: SetSecretCommand,
): Promise<SetSecretResult> {
  if (!isSecretName(command.name)) return { kind: 'invalid-name' }
  if (command.value.length === 0) return { kind: 'invalid-value', reason: 'empty' }
  if (command.value.length > MAX_SECRET_VALUE_LENGTH) {
    return { kind: 'invalid-value', reason: 'too-long' }
  }

  const sealed = await deps.secrets.seal(command.name, command.value)
  const row = await deps.uow.repos.secrets.put({
    name: command.name,
    ciphertext: sealed.ciphertext,
    wrappedKey: sealed.wrappedKey.wrapped,
    keyId: sealed.wrappedKey.keyId,
    now: deps.clock.now(),
  })
  await audit(deps, {
    type: SECRET_AUDIT_EVENTS.set,
    actorUserId: command.actor,
    targetId: command.name,
    // The name and the key id, and nothing else. Not the value, not its
    // ciphertext, not its length — a length is a clue about a password.
    metadata: { keyId: row.keyId },
  })
  return { kind: 'set', secret: toSummary(row) }
}

export type GetSecretResult =
  | { readonly kind: 'secret'; readonly value: string }
  | { readonly kind: 'not-found' }
  /**
   * The row is there and does not open: a master key was lost, the ciphertext
   * was edited, or the row was sealed under another name and moved here.
   */
  | { readonly kind: 'unreadable' }

/**
 * The value, for the one caller about to use it.
 *
 * Nothing on the HTTP surface calls this: it is for the moment an OIDC
 * exchange or an SMTP connection needs the secret, which is the only time a
 * secret is decrypted at all (ADR-034).
 */
export async function getSecret(deps: SecretsDependencies, name: string): Promise<GetSecretResult> {
  const row = await deps.uow.repos.secrets.find(name)
  if (row === null) return { kind: 'not-found' }
  const value = await deps.secrets.open(name, {
    ciphertext: row.ciphertext,
    wrappedKey: { keyId: row.keyId, wrapped: row.wrappedKey },
  })
  return value === null ? { kind: 'unreadable' } : { kind: 'secret', value }
}

/** Names, key ids, and dates. Never values — this is what an API may show. */
export async function listSecretNames(
  deps: SecretsDependencies,
): Promise<readonly SecretSummary[]> {
  return await deps.uow.repos.secrets.list()
}

export type DescribeSecretResult =
  | { readonly kind: 'secret'; readonly secret: SecretSummary }
  | { readonly kind: 'not-found' }

export async function describeSecret(
  deps: SecretsDependencies,
  name: string,
): Promise<DescribeSecretResult> {
  const row = await deps.uow.repos.secrets.find(name)
  return row === null ? { kind: 'not-found' } : { kind: 'secret', secret: toSummary(row) }
}

export type DeleteSecretResult = { readonly kind: 'deleted' } | { readonly kind: 'not-found' }

export async function deleteSecret(
  deps: SecretsDependencies,
  name: string,
  actor: UserId,
): Promise<DeleteSecretResult> {
  if (!(await deps.uow.repos.secrets.delete(name))) return { kind: 'not-found' }
  await audit(deps, {
    type: SECRET_AUDIT_EVENTS.deleted,
    actorUserId: actor,
    targetId: name,
    metadata: {},
  })
  return { kind: 'deleted' }
}

/** Secrets re-wrapped per round of the rotation loop. */
export const ROTATION_BATCH = 100

export interface RotateMasterKeyResult {
  readonly rewrapped: number
  /** Secrets whose old master key is no longer available to unwrap them. */
  readonly unreadable: readonly string[]
  readonly keyId: string
}

/**
 * Re-wrap every data key with the current master key (ADR-034).
 *
 * Ciphertext is never touched, so this costs one small decrypt-and-encrypt
 * per secret however large the secret is, and it is resumable: each row is
 * updated as it is re-wrapped, so an interrupted rotation leaves a table that
 * still reads and a second run that finishes the job. A row whose old key has
 * gone is reported by name, not skipped silently — that secret has to be
 * entered again.
 *
 * Each write is a compare-and-swap on the envelope this loop read. An
 * administrator replacing a secret while the rotation runs would otherwise
 * have the rotation write the *old* value's data key over the new value's,
 * and the new value would never open again. A refused write is simply the row
 * read afresh on the next pass, because the new value is already on the
 * current key and drops out of the query.
 */
export async function rotateMasterKey(
  deps: SecretsDependencies,
  actor: UserId,
): Promise<RotateMasterKeyResult> {
  const keyId = deps.secrets.currentKeyId
  const unreadable: string[] = []
  let rewrapped = 0
  let after: SecretCursor | undefined

  // One walk of the table in `(created_at, name)` order. A row this pass
  // re-wrapped leaves the query, and a row it could not re-wrap stays in it
  // but behind the cursor, so neither is ever read twice and the walk always
  // advances — the reason for a cursor rather than "ask for the first page
  // again until it is empty", which a single unreadable secret would spin on
  // for ever.
  for (;;) {
    const page: readonly SecretRow[] = await deps.uow.repos.secrets.listWrappedWithOther({
      keyId,
      limit: ROTATION_BATCH,
      ...(after === undefined ? {} : { after }),
    })
    const last = page.at(-1)
    if (last === undefined) break
    for (const row of page) {
      const outcome = await rewrapOne(deps, row)
      if (outcome === 'rewrapped') rewrapped += 1
      if (outcome === 'unreadable') unreadable.push(row.name)
    }
    after = { createdAt: last.createdAt, name: last.name }
  }

  await audit(deps, {
    type: SECRET_AUDIT_EVENTS.masterKeyRotated,
    actorUserId: actor,
    targetId: keyId,
    metadata: { rewrapped, unreadable },
  })
  return { rewrapped, unreadable, keyId }
}

/**
 * One secret onto the current master key.
 *
 * `moved` is the compare-and-swap being refused: somebody replaced this
 * secret between the read and the write, so the row now holds a value this
 * loop never saw, already wrapped by the current key. Nothing to report and
 * nothing to retry.
 */
async function rewrapOne(
  deps: SecretsDependencies,
  row: SecretRow,
): Promise<'rewrapped' | 'unreadable' | 'moved'> {
  const sealed = await deps.secrets.rewrap({
    ciphertext: row.ciphertext,
    wrappedKey: { keyId: row.keyId, wrapped: row.wrappedKey },
  })
  if (sealed === null) return 'unreadable'
  const written = await deps.uow.repos.secrets.rewrap({
    name: row.name,
    fromKeyId: row.keyId,
    fromWrappedKey: row.wrappedKey,
    wrappedKey: sealed.wrappedKey.wrapped,
    keyId: sealed.wrappedKey.keyId,
    now: deps.clock.now(),
  })
  return written ? 'rewrapped' : 'moved'
}

function toSummary(row: SecretRow): SecretSummary {
  return {
    name: row.name,
    keyId: row.keyId,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
    rewrappedAt: row.rewrappedAt,
  }
}

async function audit(
  deps: SecretsDependencies,
  event: {
    readonly type: string
    readonly actorUserId: UserId
    readonly targetId: string
    readonly metadata: Readonly<Record<string, unknown>>
  },
): Promise<void> {
  await deps.uow.repos.audit.write({
    id: deps.ids.uuid(),
    type: event.type,
    actorUserId: event.actorUserId,
    targetType: 'secret',
    targetId: event.targetId,
    metadata: event.metadata,
    now: deps.clock.now(),
  })
}
