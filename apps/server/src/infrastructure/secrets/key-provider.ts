import { createHmac } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

import { BRAND } from '@quill/brand'
import type { KeyProvider, WrappedKey } from '@quill/application'

import type { MasterKeyConfig } from '../../config.ts'
import { KEY_BYTES, openWithKey, sealWithKey } from './aes-gcm.ts'

/**
 * Where the master key comes from (ADR-034, ADR-011).
 *
 * Two implementations ship: the key in an environment variable, which is the
 * self-host default, and a key file on a mounted volume, which is what a
 * platform with a file-shaped secret store gives you. Both are the same
 * provider over different key material, because both really do hold the key;
 * the cloud key services ADR-034 names do not, which is why the port is
 * `wrap`/`unwrap` rather than "give me the key" and why adding one of them is
 * a new implementation of this port rather than a change to it.
 *
 * A provider holds more than one key: the current one, which wraps, and any
 * number of retired ones, which only unwrap. That is what makes a rotation
 * something an operator can do without downtime — add the new key, restart,
 * rotate, then drop the old key from the environment.
 */

/**
 * The domain separator the key id is derived under. Versioned, because every
 * stored row names a key by this derivation: a change is a `v2` beside it,
 * with both offered on the way in, never an edit to this string.
 */
const KEY_ID_LABEL = `${BRAND.slug}/master-key-id/v1`

/**
 * A key's id is derived from the key itself, not a name an operator invents.
 *
 * It means a row records which key opens it without anybody having to keep a
 * naming scheme straight across two deployments, and it means putting the
 * same key back — after a rolled-back release, say — is recognised rather
 * than looking like a third key.
 *
 * It is an HMAC of a fixed label under the key, not a plain digest of the
 * key. A digest would make the id a verifier for the key itself: a candidate
 * key could be confirmed by hashing it and comparing, which turns a published
 * `key_id` — in a database dump, a log line, an audit row — into an oracle
 * for offline guessing. Under HMAC the id says only "this key", to somebody
 * who already has it.
 */
export function keyIdFor(key: Uint8Array): string {
  return createHmac('sha256', key).update(KEY_ID_LABEL).digest('hex').slice(0, 16)
}

/**
 * The label a wrapped data key is sealed against: the id of the master key
 * that wrapped it. It binds the wrapped key to the `key_id` column beside it,
 * so a wrapped key cannot be lifted into a row that claims a different key.
 */
function wrapLabel(keyId: string): string {
  return `wrap:v1:${keyId}`
}

export class MasterKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MasterKeyError'
  }
}

/** Exactly the base64 of thirty-two bytes: forty-three characters and one `=`. */
const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/

const HOW_TO_GENERATE = `Generate one with: node -e "console.log(require('node:crypto').randomBytes(${KEY_BYTES}).toString('base64'))"`

/**
 * A base64 key, decoded and checked.
 *
 * The spelling is checked before the length, because `Buffer.from(_,
 * 'base64')` is lenient to a fault: it drops whatever it does not recognise
 * and decodes the rest, so a key with a character lost in a copy, or a stray
 * quote around it, silently becomes a *different* key of a plausible length —
 * and a different key means every secret already stored stops opening.
 */
export function decodeMasterKey(value: string, where: string): Uint8Array {
  if (!BASE64_KEY.test(value)) {
    throw new MasterKeyError(
      `${where} must be ${KEY_BYTES} bytes in standard base64, and this is not base64 of that ` +
        `length. ${HOW_TO_GENERATE}`,
    )
  }
  const key = Buffer.from(value, 'base64')
  /* v8 ignore next 5 -- the pattern already fixes the decoded length; the check only keeps this total. */
  if (key.length !== KEY_BYTES) {
    throw new MasterKeyError(
      `${where} must be ${KEY_BYTES} base64-encoded bytes, and decodes to ${key.length}. ${HOW_TO_GENERATE}`,
    )
  }
  return key
}

/**
 * A provider over keys this process holds, the first of which is current.
 *
 * The data key is wrapped as base64 text rather than as raw bytes so that the
 * whole envelope — ciphertext and wrapped key alike — is one `text` column
 * and one encoding, with nothing to get wrong at the database boundary.
 */
export function createLocalKeyProvider(keys: readonly Uint8Array[]): KeyProvider {
  const [current] = keys
  if (current === undefined) throw new MasterKeyError('A key provider needs at least one key')
  const byId = new Map(keys.map((key) => [keyIdFor(key), key]))
  const currentKeyId = keyIdFor(current)

  return {
    currentKeyId,
    keyIds: [...byId.keys()],

    async wrap(dataKey: Uint8Array): Promise<WrappedKey> {
      return {
        keyId: currentKeyId,
        wrapped: sealWithKey(
          current,
          Buffer.from(dataKey).toString('base64'),
          wrapLabel(currentKeyId),
        ),
      }
    },

    async unwrap(key: WrappedKey): Promise<Uint8Array | null> {
      const master = byId.get(key.keyId)
      if (master === undefined) return null
      const unwrapped = openWithKey(master, key.wrapped, wrapLabel(key.keyId))
      return unwrapped === null ? null : Buffer.from(unwrapped, 'base64')
    },
  }
}

/**
 * Lines of base64 keys, current first; blank lines and `#` comments ignored,
 * so a key file can say which key is which and when it was added.
 */
export function parseKeyFile(contents: string, path: string): readonly Uint8Array[] {
  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
  if (lines.length === 0) throw new MasterKeyError(`${path} holds no key`)
  return lines.map((line, index) => decodeMasterKey(line, `Line ${index + 1} of ${path}`))
}

/** Where a key provider reports something an operator should know. */
export interface KeyProviderLog {
  warn(details: object, message: string): void
}

/**
 * Where a provider reports when nobody passed a log: a script, a test, the
 * OpenAPI export. Exported so a test can reach the same object the default
 * reaches, rather than one that merely looks like it — this function runs
 * only on the platform that warns, and a coverage gate that varies by host is
 * a gate nobody can trust.
 */
export const SILENT_KEY_PROVIDER_LOG: KeyProviderLog = { warn: () => undefined }

/**
 * A key file may not be readable by anyone but its owner.
 *
 * The master key is the one secret that makes every other one readable, and a
 * world-readable file on a shared volume hands it to every process on the
 * host. Refused rather than warned about, because the fix is one `chmod` and
 * the failure it prevents is total.
 *
 * Windows reports a mode that means nothing — `0o666` for every file,
 * whatever its ACL says — so there the check would refuse every key file for
 * no reason. It warns there instead, naming what it could not check.
 */
export function refuseKeyFileAnyoneElseCanRead(path: string, mode: number): void {
  const permissions = mode & 0o777
  if ((permissions & 0o077) === 0) return
  throw new MasterKeyError(
    `The master key file ${path} is readable by more than its owner (mode ` +
      `${permissions.toString(8).padStart(3, '0')}). Run: chmod 600 ${path}`,
  )
}

async function checkKeyFilePermissions(
  path: string,
  log: KeyProviderLog,
  platform: NodeJS.Platform,
): Promise<void> {
  if (platform === 'win32') {
    log.warn(
      { path },
      'Cannot check the master key file’s permissions on this platform; make sure its ACL ' +
        'grants access to the account running the server and to nobody else.',
    )
    return
  }
  refuseKeyFileAnyoneElseCanRead(path, (await stat(path)).mode)
}

/**
 * The key provider this deployment's configuration chose.
 *
 * `platform` is a parameter and not a read of `process.platform` so that both
 * halves of the permission check above can be exercised on either kind of
 * host; nothing but a test ever passes it.
 */
export async function createKeyProvider(
  config: MasterKeyConfig,
  log: KeyProviderLog = SILENT_KEY_PROVIDER_LOG,
  platform: NodeJS.Platform = process.platform,
): Promise<KeyProvider> {
  if (config.driver === 'file') {
    const contents = await readFile(config.path, 'utf8').catch((error: unknown) => {
      throw new MasterKeyError(
        `Could not read the master key file ${config.path}: ${String(error)}`,
      )
    })
    await checkKeyFilePermissions(config.path, log, platform)
    return createLocalKeyProvider(parseKeyFile(contents, config.path))
  }
  return createLocalKeyProvider(
    config.keys.map((key, index) =>
      decodeMasterKey(key, index === 0 ? 'MASTER_KEY' : 'MASTER_KEY_PREVIOUS'),
    ),
  )
}
