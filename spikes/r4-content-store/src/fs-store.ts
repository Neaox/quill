/**
 * Filesystem ObjectStore: a real bare Git repository, loose objects only,
 * plus a lockfile-based compare-and-swap on refs (the same protocol the
 * git CLI uses, so concurrent CLI access stays safe).
 *
 * Also includes a packfile *reader* so the store keeps working after the
 * repository has been `git gc`-ed.
 */

import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { inflateSync } from 'node:zlib'
import {
  decodeLoose,
  encodeLoose,
  type GitObjectType,
  type ObjectStore,
  type RawObject,
} from './git-core.ts'

export interface FsStoreOptions {
  /** zlib level for loose objects. git's core.compression default is 1. */
  compression?: number
}

export class FsObjectStore implements ObjectStore {
  readonly gitdir: string
  readonly compression: number
  private packs: PackIndex[] | null = null

  constructor(gitdir: string, options: FsStoreOptions = {}) {
    this.gitdir = gitdir
    this.compression = options.compression ?? 1
  }

  static async init(gitdir: string, options: FsStoreOptions = {}): Promise<FsObjectStore> {
    await fs.mkdir(path.join(gitdir, 'objects', 'info'), { recursive: true })
    await fs.mkdir(path.join(gitdir, 'objects', 'pack'), { recursive: true })
    await fs.mkdir(path.join(gitdir, 'refs', 'heads'), { recursive: true })
    await fs.mkdir(path.join(gitdir, 'refs', 'tags'), { recursive: true })
    await fs.writeFile(path.join(gitdir, 'HEAD'), 'ref: refs/heads/main\n')
    await fs.writeFile(
      path.join(gitdir, 'config'),
      '[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = true\n',
    )
    await fs.writeFile(path.join(gitdir, 'description'), 'Quill content store\n')
    return new FsObjectStore(gitdir, options)
  }

  private looseP(oid: string): string {
    return path.join(this.gitdir, 'objects', oid.slice(0, 2), oid.slice(2))
  }

  async has(oid: string): Promise<boolean> {
    if (existsSync(this.looseP(oid))) return true
    return (await this.read(oid)) !== null
  }

  async read(oid: string): Promise<RawObject | null> {
    try {
      const raw = await fs.readFile(this.looseP(oid))
      return decodeLoose(raw)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    return await this.readFromPacks(oid)
  }

  async write(oid: string, type: GitObjectType, body: Buffer): Promise<void> {
    const p = this.looseP(oid)
    const dir = path.dirname(p)
    try {
      await fs.writeFile(p, encodeLoose(type, body, this.compression), { flag: 'wx' })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EEXIST') return
      if (code !== 'ENOENT') throw err
      await fs.mkdir(dir, { recursive: true })
      try {
        await fs.writeFile(p, encodeLoose(type, body, this.compression), { flag: 'wx' })
      } catch (err2) {
        if ((err2 as NodeJS.ErrnoException).code !== 'EEXIST') throw err2
      }
    }
  }

  async readRef(name: string): Promise<string | null> {
    try {
      const text = await fs.readFile(path.join(this.gitdir, name), 'utf8')
      return text.trim()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      // fall back to packed-refs
      try {
        const packed = await fs.readFile(path.join(this.gitdir, 'packed-refs'), 'utf8')
        for (const line of packed.split('\n')) {
          if (line.startsWith('#') || line.startsWith('^')) continue
          const [oid, ref] = line.split(' ')
          if (ref === name && oid) return oid
        }
      } catch {
        /* no packed-refs */
      }
      return null
    }
  }

  /**
   * Lockfile CAS, exactly the git protocol: create `<ref>.lock` exclusively,
   * re-read the ref under the lock, compare, rename into place.
   * Returns false (without clobbering) when the ref moved under us.
   */
  async casRef(name: string, expected: string | null, next: string): Promise<boolean> {
    const refPath = path.join(this.gitdir, name)
    const lockPath = `${refPath}.lock`
    let handle
    try {
      handle = await fs.open(lockPath, 'wx')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // EEXIST: someone holds the lock.
      // EPERM/EACCES on Windows: the lock file is in "pending delete" state
      // because the previous holder just unlinked it while we still had a
      // directory entry for it. Both mean "contended, try again".
      if (code === 'EEXIST' || code === 'EPERM' || code === 'EACCES') return false
      throw err
    }
    try {
      const actual = await this.readRef(name)
      if (actual !== expected) return false
      await handle.writeFile(`${next}\n`)
      await handle.close()
      handle = undefined
      await renameWithWindowsRetry(lockPath, refPath)
      // reflog keeps `git log -g` honest and is what makes the repo feel real
      await this.appendReflog(name, expected, next)
      return true
    } finally {
      if (handle) await handle.close()
      // leave no stale lock behind on any failure path
      if (existsSync(lockPath)) await fs.rm(lockPath, { force: true })
    }
  }

  private reflogDirReady = new Set<string>()

  private async appendReflog(name: string, from: string | null, to: string): Promise<void> {
    const p = path.join(this.gitdir, 'logs', name)
    const dir = path.dirname(p)
    if (!this.reflogDirReady.has(dir)) {
      await fs.mkdir(dir, { recursive: true })
      this.reflogDirReady.add(dir)
    }
    const zero = '0'.repeat(40)
    const ts = Math.floor(Date.now() / 1000)
    await fs.appendFile(p, `${from ?? zero} ${to} Quill <quill@localhost> ${ts} +0000\tpublish\n`)
  }

  // ------------------------------------------------------------- packfiles

  private async loadPacks(): Promise<PackIndex[]> {
    if (this.packs) return this.packs
    const dir = path.join(this.gitdir, 'objects', 'pack')
    let names: string[] = []
    try {
      names = await fs.readdir(dir)
    } catch {
      /* none */
    }
    const packs: PackIndex[] = []
    for (const n of names) {
      if (!n.endsWith('.idx')) continue
      packs.push(await PackIndex.open(path.join(dir, n)))
    }
    this.packs = packs
    return packs
  }

  /** Drop the packfile cache (call after a `git gc` happened out of band). */
  invalidatePacks(): void {
    this.packs = null
  }

  private async readFromPacks(oid: string): Promise<RawObject | null> {
    for (const pack of await this.loadPacks()) {
      const o = pack.read(oid)
      if (o) return o
    }
    return null
  }
}

/**
 * Windows only: renaming over a destination that another process (or another
 * async read in this process) currently has open fails with EPERM/EACCES.
 * git-for-windows solves this the same way — bounded retry with backoff.
 * On Linux/macOS rename(2) is atomic and this loop never spins.
 */
export let renameRetries = 0
async function renameWithWindowsRetry(from: string, to: string): Promise<void> {
  const maxAttempts = 50
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if ((code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') || attempt >= maxAttempts) {
        throw err
      }
      renameRetries++
      await new Promise((r) => setTimeout(r, Math.min(attempt, 10)))
    }
  }
}

/** Minimal v2 .idx + .pack reader, enough to survive `git gc`. */
class PackIndex {
  private idx: Buffer
  private pack: Buffer
  private count: number
  private oidStart: number
  private crcStart: number
  private offStart: number

  private constructor(idx: Buffer, pack: Buffer) {
    this.idx = idx
    this.pack = pack
    this.count = idx.readUInt32BE(8 + 255 * 4)
    this.oidStart = 8 + 256 * 4
    this.crcStart = this.oidStart + this.count * 20
    this.offStart = this.crcStart + this.count * 4
  }

  static async open(idxPath: string): Promise<PackIndex> {
    const idx = await fs.readFile(idxPath)
    if (idx.readUInt32BE(0) !== 0xff744f63 || idx.readUInt32BE(4) !== 2) {
      throw new Error(`${idxPath}: only pack index v2 is supported by this spike`)
    }
    const pack = await fs.readFile(idxPath.replace(/\.idx$/, '.pack'))
    return new PackIndex(idx, pack)
  }

  private find(oid: string): number {
    const target = Buffer.from(oid, 'hex')
    const first = target[0] as number
    let lo = first === 0 ? 0 : this.idx.readUInt32BE(8 + (first - 1) * 4)
    let hi = this.idx.readUInt32BE(8 + first * 4)
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const cmp = this.idx.compare(
        target,
        0,
        20,
        this.oidStart + mid * 20,
        this.oidStart + mid * 20 + 20,
      )
      // NOTE: `cmp` is idx-entry vs target (Buffer.compare's receiver is the
      // source), so a negative result means the entry sorts BEFORE the target.
      if (cmp === 0) return mid
      if (cmp < 0) lo = mid + 1
      else hi = mid
    }
    return -1
  }

  private offsetAt(i: number): number {
    const v = this.idx.readUInt32BE(this.offStart + i * 4)
    if ((v & 0x80000000) === 0) return v
    const big = this.offStart + this.count * 4 + (v & 0x7fffffff) * 8
    return Number(this.idx.readBigUInt64BE(big))
  }

  private oidAt(i: number): string {
    return this.idx.subarray(this.oidStart + i * 20, this.oidStart + i * 20 + 20).toString('hex')
  }

  read(oid: string): RawObject | null {
    const i = this.find(oid)
    if (i === -1) return null
    return this.readAt(this.offsetAt(i))
  }

  private readAt(offset: number): RawObject {
    const types: Array<GitObjectType | 'ofs_delta' | 'ref_delta' | undefined> = [
      undefined,
      'commit',
      'tree',
      'blob',
      'tag',
      undefined,
      'ofs_delta',
      'ref_delta',
    ]
    let p = offset
    let byte = this.pack[p++] as number
    const typeId = (byte >> 4) & 0b111
    let size = byte & 0b1111
    let shift = 4
    while (byte & 0x80) {
      byte = this.pack[p++] as number
      size |= (byte & 0x7f) << shift
      shift += 7
    }
    const kind = types[typeId]
    if (kind === 'ofs_delta' || kind === 'ref_delta') {
      let baseOffset: number
      if (kind === 'ofs_delta') {
        let b = this.pack[p++] as number
        let ofs = b & 0x7f
        while (b & 0x80) {
          b = this.pack[p++] as number
          ofs = ((ofs + 1) << 7) | (b & 0x7f)
        }
        baseOffset = offset - ofs
      } else {
        const baseOid = this.pack.subarray(p, p + 20).toString('hex')
        p += 20
        const j = this.find(baseOid)
        baseOffset = this.offsetAt(j)
      }
      const base = this.readAt(baseOffset)
      const delta = inflateSync(this.pack.subarray(p))
      return { type: base.type, body: applyDelta(delta, base.body) }
    }
    const body = inflateSync(this.pack.subarray(p), { maxOutputLength: size + 1 })
    return { type: kind as GitObjectType, body }
  }
}

function applyDelta(delta: Buffer, base: Buffer): Buffer {
  let p = 0
  const varint = (): number => {
    let v = 0
    let shift = 0
    let b: number
    do {
      b = delta[p++] as number
      v |= (b & 0x7f) << shift
      shift += 7
    } while (b & 0x80)
    return v
  }
  varint() // base size
  const outSize = varint()
  const out = Buffer.allocUnsafe(outSize)
  let o = 0
  while (p < delta.length) {
    const cmd = delta[p++] as number
    if (cmd & 0x80) {
      let copyOffset = 0
      let copySize = 0
      if (cmd & 0x01) copyOffset |= (delta[p++] as number) << 0
      if (cmd & 0x02) copyOffset |= (delta[p++] as number) << 8
      if (cmd & 0x04) copyOffset |= (delta[p++] as number) << 16
      if (cmd & 0x08) copyOffset |= (delta[p++] as number) << 24
      if (cmd & 0x10) copySize |= (delta[p++] as number) << 0
      if (cmd & 0x20) copySize |= (delta[p++] as number) << 8
      if (cmd & 0x40) copySize |= (delta[p++] as number) << 16
      if (copySize === 0) copySize = 0x10000
      base.copy(out, o, copyOffset, copyOffset + copySize)
      o += copySize
    } else {
      delta.copy(out, o, p, p + cmd)
      o += cmd
      p += cmd
    }
  }
  return out
}
