import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { hashObject, serialiseObject } from '../git/objects.ts'
import { newWorkspaceId } from '../test-fixtures.ts'
import {
  FilesystemObjectStore,
  FilesystemObjectStoreProvider,
  LeakedLockError,
} from './filesystem-object-store.ts'

const REF = 'refs/heads/main'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const root = await mkdtemp(join(tmpdir(), 'content-store-fs-'))
const opened: FilesystemObjectStore[] = []
let repositories = 0

const CLOCK = new Date('2026-09-12T10:00:00Z')
const NOW = (): Date => CLOCK

/** A real object: its id is the hash of its own bytes, as every store assumes. */
function blob(text: string): { oid: string; bytes: Buffer } {
  const body = Buffer.from(text, 'utf8')
  return { oid: hashObject('blob', body), bytes: serialiseObject('blob', body) }
}

afterAll(async () => {
  await Promise.all(opened.map((store) => store.close()))
  await rm(root, { recursive: true, force: true })
})

async function repository(): Promise<FilesystemObjectStore> {
  repositories += 1
  const created = await FilesystemObjectStore.create(join(root, `repository-${repositories}.git`), {
    now: NOW,
  })
  opened.push(created)
  return created
}

let store: FilesystemObjectStore

beforeEach(async () => {
  store = await repository()
})

describe('bare repository layout', () => {
  it('is a bare repository the git CLI recognises', async () => {
    expect(await readFile(join(store.gitdir, 'HEAD'), 'utf8')).toBe('ref: refs/heads/main\n')
    expect(await readFile(join(store.gitdir, 'config'), 'utf8')).toContain('bare = true')
  })

  it('can be created twice over the same directory', async () => {
    const hello = blob('hello\n')
    await store.write(hello.oid, hello.bytes)
    const reopened = await FilesystemObjectStore.create(store.gitdir, { now: NOW })
    opened.push(reopened)
    expect(await reopened.read(hello.oid)).not.toBeNull()
  })

  it('leaves an operator’s own config and description alone on the next start', async () => {
    await writeFile(join(store.gitdir, 'config'), '[core]\n\tbare = true\n[gc]\n\tauto = 0\n')
    await writeFile(join(store.gitdir, 'description'), 'Edited by an operator\n')
    const reopened = await FilesystemObjectStore.create(store.gitdir, { now: NOW })
    opened.push(reopened)
    expect(await readFile(join(store.gitdir, 'config'), 'utf8')).toContain('auto = 0')
    expect(await readFile(join(store.gitdir, 'description'), 'utf8')).toBe(
      'Edited by an operator\n',
    )
  })
})

describe('objects', () => {
  it('reads back what it wrote, zlib-compressed on disk', async () => {
    const hello = blob('hello\n')
    await store.write(hello.oid, hello.bytes)
    expect(Buffer.from((await store.read(hello.oid)) ?? [])).toEqual(hello.bytes)
    const onDisk = await readFile(
      join(store.gitdir, 'objects', hello.oid.slice(0, 2), hello.oid.slice(2)),
    )
    expect(onDisk.readUInt8(0)).toBe(0x78) // zlib header
  })

  it('returns null for an object it does not hold', async () => {
    expect(await store.read(A)).toBeNull()
    expect(await store.has(A)).toBe(false)
  })

  it('refuses a name that is not an object id, so no path can escape', async () => {
    await expect(store.read('../../../etc/passwd')).rejects.toThrow(/is not an object id/)
    await expect(store.write('..', Buffer.alloc(0))).rejects.toThrow(/is not an object id/)
  })

  it('leaves no temporary file behind', async () => {
    const hello = blob('hello\n')
    await store.write(hello.oid, hello.bytes)
    expect(
      (await readdir(join(store.gitdir, 'objects'))).filter((n) => n.startsWith('tmp_')),
    ).toEqual([])
  })

  it('repairs an object a crash left half written', async () => {
    const hello = blob('hello\n')
    const path = join(store.gitdir, 'objects', hello.oid.slice(0, 2), hello.oid.slice(2))
    await mkdir(join(store.gitdir, 'objects', hello.oid.slice(0, 2)), { recursive: true })
    await writeFile(path, deflateSync(hello.bytes).subarray(0, 4))
    await store.write(hello.oid, hello.bytes)
    expect(Buffer.from((await store.read(hello.oid)) ?? [])).toEqual(hello.bytes)
  })

  it('refuses to hand back bytes that do not hash to the name asked for', async () => {
    const impostor = blob('hello\n')
    await store.write(A, impostor.bytes)
    await expect(store.read(A)).rejects.toThrow(/the repository is corrupt/)
  })

  it('writes a batch', async () => {
    const entries = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].map(
      (text) => blob(text),
    )
    await store.writeBatch(entries)
    for (const entry of entries) expect(await store.has(entry.oid)).toBe(true)
  })

  it('reports a write failure that is not a duplicate', async () => {
    const first = blob('one')
    const second = blob(`two ${first.oid.slice(0, 2)}`)
    await store.write(first.oid, first.bytes)
    await rm(join(store.gitdir, 'objects', first.oid.slice(0, 2)), { recursive: true })
    // Same first two characters, so the directory this store believes it has
    // already prepared is the one that has just been removed.
    const sameDirectory = `${first.oid.slice(0, 2)}${second.oid.slice(2)}`
    await expect(store.write(sameDirectory, second.bytes)).rejects.toThrow(/ENOENT/)
    expect(
      (await readdir(join(store.gitdir, 'objects'))).filter((n) => n.startsWith('tmp_')),
    ).toEqual([])
  })

  it('forgets the packs it had cached when it is told to', async () => {
    expect(await store.has(A)).toBe(false)
    await store.invalidatePacks()
    expect(await store.has(A)).toBe(false)
  })

  it('reports a read failure that is not a missing file', async () => {
    await mkdir(join(store.gitdir, 'objects', A.slice(0, 2), A.slice(2)), { recursive: true })
    await expect(store.read(A)).rejects.toThrow(/EISDIR|EPERM/)
  })
})

describe('refs', () => {
  it('is unborn until the first compare-and-swap', async () => {
    expect(await store.readRef(REF)).toBeNull()
    expect(await store.casRef(REF, null, A)).toBe(true)
    expect(await store.readRef(REF)).toBe(A)
  })

  it('refuses to create a ref that already exists', async () => {
    await store.casRef(REF, null, A)
    expect(await store.casRef(REF, null, B)).toBe(false)
    expect(await store.readRef(REF)).toBe(A)
  })

  it('refuses to advance a ref that has moved', async () => {
    await store.casRef(REF, null, A)
    expect(await store.casRef(REF, B, A)).toBe(false)
  })

  it('loses the race, without clobbering, while another holder has the lock', async () => {
    const lockPath = join(store.gitdir, `${REF}.lock`)
    await store.casRef(REF, null, A)
    await writeFile(lockPath, '')
    await utimes(lockPath, CLOCK, CLOCK)
    expect(await store.casRef(REF, A, B)).toBe(false)
    expect(await store.readRef(REF)).toBe(A)
    await rm(lockPath)
  })

  it('leaves the other holder’s lock exactly where it found it', async () => {
    const lockPath = join(store.gitdir, `${REF}.lock`)
    await store.casRef(REF, null, A)
    await writeFile(lockPath, 'another process\n')
    await utimes(lockPath, CLOCK, CLOCK)
    expect(await store.casRef(REF, A, B)).toBe(false)
    expect(await readFile(lockPath, 'utf8')).toBe('another process\n')
    await rm(lockPath)
  })

  it('renames its own lock into place rather than deleting it', async () => {
    const lockPath = join(store.gitdir, `${REF}.lock`)
    expect(await store.casRef(REF, null, A)).toBe(true)
    expect(existsSync(lockPath)).toBe(false)
    expect(await readFile(join(store.gitdir, REF), 'utf8')).toBe(`${A}\n`)
  })

  it('leaves no lock file behind after a failed compare-and-swap', async () => {
    await store.casRef(REF, null, A)
    await store.casRef(REF, B, A)
    expect(await store.casRef(REF, A, B)).toBe(true)
  })

  it('reports a lock failure that is not contention', async () => {
    await expect(store.casRef('refs/heads/nowhere/deep', null, A)).rejects.toThrow(/ENOENT/)
  })

  it('tells a leaked lock apart from a publisher that holds it', async () => {
    const lockPath = join(store.gitdir, `${REF}.lock`)
    await store.casRef(REF, null, A)
    await writeFile(lockPath, '')
    const longAgo = new Date(CLOCK.getTime() - 10 * 60_000)
    await utimes(lockPath, longAgo, longAgo)
    await expect(store.casRef(REF, A, B)).rejects.toThrow(LeakedLockError)
    // Reported, never removed: the holder may be a slow `git` in a shell.
    expect(existsSync(lockPath)).toBe(true)
    await expect(store.casRef(REF, A, B)).rejects.toThrow(/remove the file to recover/)
    await rm(lockPath)
  })

  it('takes the staleness threshold from the caller', async () => {
    const impatient = new FilesystemObjectStore(store.gitdir, {
      now: NOW,
      staleLockMilliseconds: 0,
    })
    const lockPath = join(store.gitdir, `${REF}.lock`)
    await writeFile(lockPath, '')
    await utimes(lockPath, CLOCK, CLOCK)
    const error = await impatient.casRef(REF, null, A).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(LeakedLockError)
    expect(error).toMatchObject({ path: lockPath })
    await rm(lockPath)
  })

  it('records the move in the reflog, and mirrors it to the one HEAD points at', async () => {
    await store.casRef(REF, null, A)
    await store.casRef(REF, A, B)
    const reflog = await readFile(join(store.gitdir, 'logs', REF), 'utf8')
    expect(reflog.split('\n').filter(Boolean)).toHaveLength(2)
    expect(reflog).toContain(`${'0'.repeat(40)} ${A}`)
    expect(reflog).toContain(`${A} ${B}`)
    expect(await readFile(join(store.gitdir, 'logs', 'HEAD'), 'utf8')).toBe(reflog)
  })

  it('dates the reflog from the clock it was given', async () => {
    await store.casRef(REF, null, A)
    const reflog = await readFile(join(store.gitdir, 'logs', REF), 'utf8')
    expect(reflog).toContain(` ${Math.floor(CLOCK.getTime() / 1000)} +0000\tpublish`)
  })

  it('mirrors nothing to HEAD when HEAD points somewhere else', async () => {
    await writeFile(join(store.gitdir, 'HEAD'), 'ref: refs/heads/other\n')
    await store.casRef(REF, null, A)
    expect(existsSync(join(store.gitdir, 'logs', 'HEAD'))).toBe(false)
  })

  it('writes no reflog entry when a lock is taken without moving the ref', async () => {
    await store.casRef(REF, null, A)
    await rm(join(store.gitdir, 'logs'), { recursive: true })
    expect(await store.casRef(REF, A, A)).toBe(true)
    expect(existsSync(join(store.gitdir, 'logs', REF))).toBe(false)
  })

  it('follows a symbolic ref, as git does for HEAD', async () => {
    await store.casRef(REF, null, A)
    expect(await store.readRef('HEAD')).toBe(A)
  })

  it('gives up on a symbolic ref that points at itself', async () => {
    await writeFile(join(store.gitdir, 'HEAD'), 'ref: HEAD\n')
    expect(await store.readRef('HEAD')).toBeNull()
  })

  it('treats the empty file git writes mid-creation as an unborn ref', async () => {
    await writeFile(join(store.gitdir, REF), '')
    expect(await store.readRef(REF)).toBeNull()
  })

  it('falls back to packed-refs, as git does after `git pack-refs`', async () => {
    await writeFile(
      join(store.gitdir, 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted\n${A} ${REF}\n^${B}\n`,
    )
    expect(await store.readRef(REF)).toBe(A)
    expect(await store.readRef('refs/heads/other')).toBeNull()
  })

  it('has no ref when there are no packed refs either', async () => {
    expect(await store.readRef('refs/heads/other')).toBeNull()
  })

  it('reports a ref read failure that is not a missing file', async () => {
    await mkdir(join(store.gitdir, REF), { recursive: true })
    await expect(store.readRef(REF)).rejects.toThrow(/EISDIR|EPERM/)
  })

  it('reports a packed-refs read failure that is not a missing file', async () => {
    await mkdir(join(store.gitdir, 'packed-refs'))
    await expect(store.readRef('refs/heads/other')).rejects.toThrow(/EISDIR|EPERM/)
  })
})

describe('FilesystemObjectStoreProvider', () => {
  it('gives each workspace one bare repository named by its id', async () => {
    const provider = new FilesystemObjectStoreProvider(join(root, 'workspaces'), { now: NOW })
    const workspace = newWorkspaceId()
    const first = await provider.forWorkspace(workspace)
    expect(first.gitdir).toBe(join(root, 'workspaces', `${workspace}.git`))
    expect(await provider.forWorkspace(workspace)).toBe(first)
    await provider.close()
  })

  it('passes its options to every repository it creates', async () => {
    const provider = new FilesystemObjectStoreProvider(join(root, 'compressed'), {
      now: NOW,
      compression: 9,
    })
    const store9 = await provider.forWorkspace(newWorkspaceId())
    const padded = blob('x'.repeat(1000))
    await store9.write(padded.oid, padded.bytes)
    const onDisk = await readFile(
      join(store9.gitdir, 'objects', padded.oid.slice(0, 2), padded.oid.slice(2)),
    )
    expect(onDisk.length).toBeLessThan(60)
    await provider.close()
  })
})
