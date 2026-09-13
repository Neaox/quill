import { createHash } from 'node:crypto'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  createKeyProvider,
  createLocalKeyProvider,
  decodeMasterKey,
  keyIdFor,
  MasterKeyError,
  parseKeyFile,
  refuseKeyFileAnyoneElseCanRead,
  SILENT_KEY_PROVIDER_LOG,
} from './key-provider.ts'

const KEY = Buffer.alloc(32, 1)
const NEXT_KEY = Buffer.alloc(32, 2)
const DATA_KEY = Buffer.alloc(32, 9)
const SILENT = { warn: (): void => undefined }

/**
 * A key file with the given mode, in a directory of its own.
 *
 * The mode is stated on the write *and* applied again after it: the create
 * mode is masked by the process umask, which on most Linux hosts would turn a
 * requested `0o600` into `0o600` but a requested `0o644` into whatever the
 * umask leaves. A fixture that says which permissions it wants has to end up
 * with them, because on Linux the permissions are the thing under test.
 */
async function keyFile(mode: number): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'master-key-'))
  const file = path.join(directory, 'keys')
  await writeFile(file, `${KEY.toString('base64')}\n`, { encoding: 'utf8', mode })
  await chmod(file, mode)
  return file
}

describe('key ids', () => {
  it('are derived from the key, so the same key is always the same id', () => {
    expect(keyIdFor(KEY)).toBe(keyIdFor(Buffer.alloc(32, 1)))
    expect(keyIdFor(KEY)).not.toBe(keyIdFor(NEXT_KEY))
    expect(keyIdFor(KEY)).toMatch(/^[0-9a-f]{16}$/)
  })

  /**
   * An id that were a plain digest of the key would be a verifier for it: a
   * candidate key could be confirmed by hashing and comparing, turning a
   * published `key_id` into an oracle for offline guessing.
   */
  it('is not a digest of the key itself', () => {
    expect(keyIdFor(KEY)).not.toBe(createHash('sha256').update(KEY).digest('hex').slice(0, 16))
  })
})

describe('decoding a key', () => {
  it('accepts thirty-two base64 bytes', () => {
    expect(decodeMasterKey(KEY.toString('base64'), 'TEST')).toEqual(KEY)
  })

  it('refuses anything else, and says how to make one', () => {
    expect(() => decodeMasterKey(Buffer.alloc(16).toString('base64'), 'TEST')).toThrow(
      /TEST must be 32 bytes in standard base64/,
    )
    expect(() => decodeMasterKey('', 'TEST')).toThrow(/randomBytes/)
  })

  /**
   * `Buffer.from(_, 'base64')` drops what it does not recognise and decodes
   * the rest, so a key with a character lost in a copy silently becomes a
   * different key — and a different key means every stored secret stops
   * opening. The spelling is checked before the bytes are.
   */
  it('refuses base64 that is lenient rather than correct', () => {
    const valid = KEY.toString('base64')
    const spellings = [
      `"${valid}"`,
      ` ${valid}`,
      valid.replace('=', ''),
      `${valid.slice(0, 20)} ${valid.slice(20)}`,
      valid.replace('A', '*'),
    ]
    const refused = spellings.map((spelling) => ({
      spelling,
      refused: (() => {
        try {
          decodeMasterKey(spelling, 'TEST')
          return false
        } catch {
          return true
        }
      })(),
    }))
    expect(refused).toEqual(spellings.map((spelling) => ({ spelling, refused: true })))
  })
})

describe('a provider over keys this process holds', () => {
  it('wraps with the current key and unwraps it again', async () => {
    const keys = createLocalKeyProvider([KEY])
    const wrapped = await keys.wrap(DATA_KEY)
    expect(wrapped.keyId).toBe(keyIdFor(KEY))
    expect(await keys.unwrap(wrapped)).toEqual(DATA_KEY)
  })

  it('wraps the data key rather than storing it', async () => {
    const wrapped = await createLocalKeyProvider([KEY]).wrap(DATA_KEY)
    expect(wrapped.wrapped).not.toContain(DATA_KEY.toString('base64'))
  })

  it('still unwraps what a retired key wrapped', async () => {
    const before = createLocalKeyProvider([KEY])
    const wrapped = await before.wrap(DATA_KEY)
    const after = createLocalKeyProvider([NEXT_KEY, KEY])
    expect(after.currentKeyId).toBe(keyIdFor(NEXT_KEY))
    expect(await after.unwrap(wrapped)).toEqual(DATA_KEY)
  })

  it('cannot unwrap what a key it no longer holds wrapped', async () => {
    const wrapped = await createLocalKeyProvider([KEY]).wrap(DATA_KEY)
    expect(await createLocalKeyProvider([NEXT_KEY]).unwrap(wrapped)).toBeNull()
  })

  it('cannot unwrap a payload the right key cannot open', async () => {
    const keys = createLocalKeyProvider([KEY])
    expect(await keys.unwrap({ keyId: keyIdFor(KEY), wrapped: 'not-a-payload' })).toBeNull()
  })

  it('refuses to exist with no key at all', () => {
    expect(() => createLocalKeyProvider([])).toThrow(MasterKeyError)
  })
})

describe('a key file’s permissions', () => {
  it('are fine when only its owner can reach it', () => {
    expect(() => refuseKeyFileAnyoneElseCanRead('keys', 0o100600)).not.toThrow()
  })

  it('are refused when anybody else can, naming the mode and the fix', () => {
    expect(() => refuseKeyFileAnyoneElseCanRead('keys', 0o100640)).toThrow(/mode 640/)
    expect(() => refuseKeyFileAnyoneElseCanRead('keys', 0o100604)).toThrow(/chmod 600 keys/)
  })
})

describe('a key file', () => {
  it('reads keys in order, ignoring blanks and comments', () => {
    const contents = [
      '# current',
      KEY.toString('base64'),
      '',
      '# retired 2026-09-01',
      `  ${NEXT_KEY.toString('base64')}  `,
    ].join('\n')
    expect(parseKeyFile(contents, 'keys')).toEqual([KEY, NEXT_KEY])
  })

  it('refuses a file with nothing in it', () => {
    expect(() => parseKeyFile('\n# only a comment\n', 'keys')).toThrow(/holds no key/)
  })

  it('names the line a bad key is on', () => {
    expect(() => parseKeyFile(`${KEY.toString('base64')}\nnope\n`, 'keys')).toThrow(
      /Line 2 of keys/,
    )
  })
})

describe('choosing a provider from configuration', () => {
  it('takes the environment keys, current first', async () => {
    const keys = await createKeyProvider({
      driver: 'environment',
      keys: [KEY.toString('base64'), NEXT_KEY.toString('base64')],
    })
    expect(keys.currentKeyId).toBe(keyIdFor(KEY))
  })

  it('reads a key file', async () => {
    // `0o600` and not the default: on Linux the permission check is real, and
    // a fixture written with whatever the umask allows is a key file the
    // server is right to refuse.
    const file = await keyFile(0o600)
    expect((await createKeyProvider({ driver: 'file', path: file })).currentKeyId).toBe(
      keyIdFor(KEY),
    )
  })

  /**
   * The master key is the one secret that makes every other one readable, so
   * a world-readable key file on a shared volume is refused rather than
   * warned about. Windows reports `0o666` for every file whatever its ACL
   * says, so there it warns and names what it could not check.
   */
  it('refuses a key file anybody but its owner can read', async () => {
    // The mode this file ends up with is the host's business — Windows
    // reports 0o666 for everything — so this asserts the refusal and the fix
    // it names, and leaves the exact rendering of the mode to the pure
    // check's own tests above, which state it without touching a disk.
    const file = await keyFile(0o644)
    await expect(
      createKeyProvider({ driver: 'file', path: file }, SILENT, 'linux'),
    ).rejects.toThrow(/is readable by more than its owner \(mode \d{3}\)\. Run: chmod 600 /)
  })

  it('warns instead where the mode means nothing', async () => {
    const warnings: object[] = []
    const provider = await createKeyProvider(
      { driver: 'file', path: await keyFile(0o644) },
      { warn: (details) => void warnings.push(details) },
      'win32',
    )
    expect(provider.currentKeyId).toBe(keyIdFor(KEY))
    expect(warnings).toEqual([{ path: expect.any(String) }])
  })

  /**
   * The warning with the log nobody passed. Both platforms are stated
   * explicitly in these tests so that every path runs on every host — a
   * coverage number that depends on which machine ran it is not a number
   * anybody can act on — and this is the one that reaches the *default*
   * `SILENT_KEY_PROVIDER_LOG`, which is only ever called on the platform that
   * warns.
   */
  it('says nothing, and gets in nobody’s way, through the log it falls back to', async () => {
    expect(SILENT_KEY_PROVIDER_LOG.warn({ path: 'keys' }, 'anything')).toBeUndefined()
    const provider = await createKeyProvider(
      { driver: 'file', path: await keyFile(0o644) },
      undefined,
      'win32',
    )
    expect(provider.currentKeyId).toBe(keyIdFor(KEY))
  })

  it('says which file it could not read', async () => {
    await expect(
      createKeyProvider({ driver: 'file', path: path.join(tmpdir(), 'no-such-key-file') }),
    ).rejects.toThrow(/Could not read the master key file/)
  })

  it('names the variable a bad environment key came from', async () => {
    await expect(
      createKeyProvider({ driver: 'environment', keys: [KEY.toString('base64'), 'nope'] }),
    ).rejects.toThrow(/MASTER_KEY_PREVIOUS/)
    await expect(createKeyProvider({ driver: 'environment', keys: ['nope'] })).rejects.toThrow(
      /MASTER_KEY must be/,
    )
  })
})
