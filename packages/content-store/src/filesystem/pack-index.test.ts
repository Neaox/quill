import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'

import { GitObjectError, hashObject, serialiseObject } from '../git/objects.ts'
import { FilesystemObjectStore } from './filesystem-object-store.ts'
import { PackIndex } from './pack-index.ts'

/**
 * Packs are built by hand rather than by `git gc`, because the reader has to
 * cope with encodings git never emits — reference deltas, the 64-bit offset
 * table, full-width copy commands — and with the corruption a disk can produce
 * on its own, and a fixture is the only way to reach either deterministically.
 * The end-to-end check against a real `git gc` lives in the git CLI
 * compatibility suite.
 */

const TYPE_COMMIT = 1
const TYPE_TREE = 2
const TYPE_BLOB = 3
const TYPE_TAG = 4
const TYPE_OFS_DELTA = 6
const TYPE_REF_DELTA = 7

interface Fixture {
  readonly oid: string
  readonly typeId: number
  /** The bytes the reader should hand back, or the delta that produces them. */
  readonly body: Buffer
  readonly delta?: { readonly base: string; readonly data: Buffer }
  readonly largeOffset?: boolean
}

const root = await mkdtemp(join(tmpdir(), 'content-store-pack-'))
const opened: PackIndex[] = []
const stores: FilesystemObjectStore[] = []
let packs = 0

afterAll(async () => {
  await Promise.all(opened.map((pack) => pack.close()))
  await Promise.all(stores.map((store) => store.close()))
  await rm(root, { recursive: true, force: true })
})

const NOW = (): Date => new Date('2026-09-12T10:00:00Z')

function oid(prefix: string): string {
  return prefix.padEnd(40, '0')
}

/** Incompressible bytes, so a record is as big deflated as it is raw. */
function noise(length: number): Buffer {
  const chunks: Buffer[] = []
  let block = createHash('sha256').update('pack fixture').digest()
  for (let filled = 0; filled < length; filled += block.length) {
    chunks.push(block)
    block = createHash('sha256').update(block).digest()
  }
  return Buffer.concat(chunks).subarray(0, length)
}

function sizeHeader(typeId: number, size: number): Buffer {
  const bytes = [(typeId << 4) | (size & 0b1111)]
  let remaining = size >> 4
  while (remaining > 0) {
    const last = bytes.length - 1
    bytes[last] = (bytes.at(last) ?? 0) | 0x80
    bytes.push(remaining & 0x7f)
    remaining >>= 7
  }
  return Buffer.from(bytes)
}

/** The pack's own "distance backwards" encoding, which is not a plain varint. */
function offsetDelta(distance: number): Buffer {
  const bytes = [distance & 0x7f]
  let remaining = distance
  while ((remaining >>= 7) > 0) {
    remaining -= 1
    bytes.push(0x80 | (remaining & 0x7f))
  }
  return Buffer.from(bytes.toReversed())
}

function varint(value: number): Buffer {
  const bytes: number[] = []
  let remaining = value
  do {
    const byte = remaining & 0x7f
    remaining >>>= 7
    bytes.push(remaining > 0 ? byte | 0x80 : byte)
  } while (remaining > 0)
  return Buffer.from(bytes)
}

function insert(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  return Buffer.concat([Buffer.from([payload.length]), payload])
}

/** A copy command that always writes all four offset and three size bytes. */
function copyWide(offset: number, size: number): Buffer {
  return Buffer.from([
    0x80 | 0x0f | 0x70,
    offset & 0xff,
    (offset >> 8) & 0xff,
    (offset >> 16) & 0xff,
    (offset >> 24) & 0xff,
    size & 0xff,
    (size >> 8) & 0xff,
    (size >> 16) & 0xff,
  ])
}

/** A copy command that writes the fewest bytes it can. */
function copyNarrow(offset: number, size: number): Buffer {
  return Buffer.from([0x80 | 0x01 | 0x10, offset & 0xff, size & 0xff])
}

/** A copy command that leaves out the offset bytes it does not need. */
function copyHighOffset(offset: number, size: number): Buffer {
  return Buffer.from([0x80 | 0x02 | 0x10, (offset >> 8) & 0xff, size & 0xff])
}

/** A copy command with no size bytes at all, which git reads as 64 KiB. */
function copyWholeBlock(offset: number): Buffer {
  return Buffer.from([0x80 | 0x01, offset & 0xff])
}

function delta(baseSize: number, outSize: number, ...commands: Buffer[]): Buffer {
  return Buffer.concat([varint(baseSize), varint(outSize), ...commands])
}

async function writePack(fixtures: readonly Fixture[]): Promise<PackIndex> {
  const pack = await PackIndex.open(await writePackFiles(fixtures, root))
  opened.push(pack)
  return pack
}

async function writePackFiles(fixtures: readonly Fixture[], directory: string): Promise<string> {
  packs += 1
  const offsets = new Map<string, number>()
  const chunks: Buffer[] = [Buffer.from('PACK'), uint32(2), uint32(fixtures.length)]
  let offset = chunks.reduce((total, chunk) => total + chunk.length, 0)
  for (const fixture of fixtures) {
    const payload = fixture.delta === undefined ? fixture.body : fixture.delta.data
    const header = sizeHeader(fixture.typeId, payload.length)
    const prefix = deltaPrefix(fixture, offset, offsets)
    const deflated = deflateSync(payload)
    offsets.set(fixture.oid, offset)
    chunks.push(header, prefix, deflated)
    offset += header.length + prefix.length + deflated.length
  }
  const body = Buffer.concat(chunks)
  const pack = Buffer.concat([body, createHash('sha1').update(body).digest()])

  const sorted = [...fixtures].toSorted((a, b) => (a.oid < b.oid ? -1 : 1))
  const large: Buffer[] = []
  const fanout: number[] = []
  for (let bucket = 0; bucket < 256; bucket += 1) {
    fanout.push(sorted.filter((f) => Number.parseInt(f.oid.slice(0, 2), 16) <= bucket).length)
  }
  const index = Buffer.concat([
    Buffer.from([0xff, 0x74, 0x4f, 0x63]),
    uint32(2),
    ...fanout.map(uint32),
    ...sorted.map((f) => Buffer.from(f.oid, 'hex')),
    ...sorted.map(() => uint32(0)),
    ...sorted.map((f) => {
      const at = offsets.get(f.oid) ?? 0
      if (f.largeOffset !== true) return uint32(at)
      const slot = large.length
      large.push(uint64(at))
      return uint32(0x80000000 + slot)
    }),
    ...large,
    pack.subarray(pack.length - 20),
  ])

  const base = join(directory, `pack-${packs}`)
  await writeFile(`${base}.pack`, pack)
  await writeFile(`${base}.idx`, Buffer.concat([index, createHash('sha1').update(index).digest()]))
  return `${base}.idx`
}

/** Raw, undeflated bytes a delta record carries before its payload. */
function deltaPrefix(fixture: Fixture, at: number, offsets: Map<string, number>): Buffer {
  if (fixture.delta === undefined) return Buffer.alloc(0)
  if (fixture.typeId === TYPE_REF_DELTA) return Buffer.from(fixture.delta.base, 'hex')
  return offsetDelta(at - (offsets.get(fixture.delta.base) ?? 0))
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}

function uint64(value: number): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(value))
  return buffer
}

describe('PackIndex.open', () => {
  it('refuses a pack index that is not version 2', async () => {
    const path = join(root, 'ancient.idx')
    await writeFile(path, Buffer.alloc(8 + 256 * 4 + 40))
    await expect(PackIndex.open(path)).rejects.toThrow(/version 2/)
  })

  it('refuses a pack index too short to hold a fanout table', async () => {
    const path = join(root, 'stub.idx')
    await writeFile(path, Buffer.alloc(64))
    await expect(PackIndex.open(path)).rejects.toThrow(/too short/)
  })

  it('refuses a pack index that is shorter than the objects it declares', async () => {
    const idxPath = await writePackFiles(
      [{ oid: oid('11'), typeId: TYPE_BLOB, body: Buffer.from('a') }],
      root,
    )
    const truncated = join(root, 'truncated.idx')
    const idx = await readFile(idxPath)
    await writeFile(truncated, idx.subarray(0, 8 + 256 * 4 + 4))
    await writeFile(truncated.replace(/\.idx$/, '.pack'), Buffer.alloc(0))
    await expect(PackIndex.open(truncated)).rejects.toThrow(/shorter than the objects/)
  })
})

describe('reading undeltified objects', () => {
  it('reads every object type a pack can hold', async () => {
    const pack = await writePack([
      { oid: oid('11'), typeId: TYPE_COMMIT, body: Buffer.from('a commit body') },
      { oid: oid('22'), typeId: TYPE_TREE, body: Buffer.from('a tree body') },
      { oid: oid('33'), typeId: TYPE_BLOB, body: Buffer.from('short') },
      { oid: oid('44'), typeId: TYPE_TAG, body: Buffer.from('a tag body') },
    ])
    expect(await pack.read(oid('11'))).toEqual({
      type: 'commit',
      body: Buffer.from('a commit body'),
    })
    expect(await pack.read(oid('22'))).toEqual({ type: 'tree', body: Buffer.from('a tree body') })
    expect(await pack.read(oid('33'))).toEqual({ type: 'blob', body: Buffer.from('short') })
    expect(await pack.read(oid('44'))).toEqual({ type: 'tag', body: Buffer.from('a tag body') })
  })

  it('reads an object whose size needs more than one header byte', async () => {
    const body = Buffer.from('x'.repeat(5000))
    const pack = await writePack([{ oid: oid('11'), typeId: TYPE_BLOB, body }])
    expect((await pack.read(oid('11')))?.body).toEqual(body)
  })

  it('grows its read window until a record fits inside it', async () => {
    const body = noise(200_000)
    const pack = await writePack([
      { oid: oid('11'), typeId: TYPE_BLOB, body },
      { oid: oid('22'), typeId: TYPE_BLOB, body: Buffer.from('after the big one') },
    ])
    expect((await pack.read(oid('11')))?.body).toEqual(body)
  })

  it('returns null for an object the pack does not hold', async () => {
    const pack = await writePack([{ oid: oid('11'), typeId: TYPE_BLOB, body: Buffer.from('a') }])
    expect(await pack.read(oid('99'))).toBeNull()
  })

  it('rejects a packed object type that is not defined', async () => {
    const pack = await writePack([{ oid: oid('11'), typeId: 5, body: Buffer.from('a') }])
    await expect(pack.read(oid('11'))).rejects.toThrow(GitObjectError)
  })

  it('reports a record whose compressed data is corrupt', async () => {
    const idxPath = await writePackFiles(
      [{ oid: oid('11'), typeId: TYPE_BLOB, body: Buffer.from('a') }],
      root,
    )
    const packPath = idxPath.replace(/\.idx$/, '.pack')
    await writeFile(
      packPath,
      Buffer.concat([
        Buffer.from('PACK'),
        uint32(2),
        uint32(1),
        Buffer.from([(3 << 4) | 1, 0x00, 0x00]),
      ]),
    )
    const pack = await PackIndex.open(idxPath)
    opened.push(pack)
    await expect(pack.read(oid('11'))).rejects.toThrow(/could not be inflated/)
  })
})

describe('finding an object', () => {
  it('searches within the fanout bucket, in both directions', async () => {
    const ids = ['aa1', 'aa3', 'aa5', 'aa7', 'aa9'].map(oid)
    const pack = await writePack(
      ids.map((id) => ({ oid: id, typeId: TYPE_BLOB, body: Buffer.from(id.slice(0, 3)) })),
    )
    for (const id of ids) expect((await pack.read(id))?.body.toString()).toBe(id.slice(0, 3))
    expect(await pack.read(oid('aa8'))).toBeNull()
  })

  it('reads an object whose id falls in the first fanout bucket', async () => {
    const pack = await writePack([
      { oid: oid('00'), typeId: TYPE_BLOB, body: Buffer.from('first bucket') },
      { oid: oid('ff'), typeId: TYPE_BLOB, body: Buffer.from('last bucket') },
    ])
    expect((await pack.read(oid('00')))?.body.toString()).toBe('first bucket')
  })

  it('follows the 64-bit offset table when the index says to', async () => {
    const pack = await writePack([
      { oid: oid('11'), typeId: TYPE_BLOB, body: Buffer.from('far away'), largeOffset: true },
    ])
    expect((await pack.read(oid('11')))?.body.toString()).toBe('far away')
  })

  it('says whether it holds an object without inflating it', async () => {
    const pack = await writePack([{ oid: oid('11'), typeId: TYPE_BLOB, body: Buffer.from('a') }])
    expect([pack.has(oid('11')), pack.has(oid('22'))]).toEqual([true, false])
  })

  it('holds nothing under a name that is not an object id', async () => {
    const pack = await writePack([{ oid: oid('11'), typeId: TYPE_BLOB, body: Buffer.from('a') }])
    expect(pack.has('../../etc/passwd')).toBe(false)
  })
})

describe('reading deltified objects', () => {
  const base = Buffer.from('the quick brown fox\n')

  it('applies an offset delta', async () => {
    const pack = await writePack([
      { oid: oid('11'), typeId: TYPE_BLOB, body: base },
      {
        oid: oid('22'),
        typeId: TYPE_OFS_DELTA,
        body: Buffer.alloc(0),
        delta: {
          base: oid('11'),
          data: delta(base.length, 19, copyWide(0, 4), insert('slow '), copyNarrow(10, 10)),
        },
      },
    ])
    expect(await pack.read(oid('22'))).toEqual({
      type: 'blob',
      body: Buffer.from('the slow brown fox\n'),
    })
  })

  it('applies an offset delta whose distance needs two bytes', async () => {
    const pack = await writePack([
      { oid: oid('11'), typeId: TYPE_BLOB, body: base },
      { oid: oid('22'), typeId: TYPE_BLOB, body: noise(400) },
      {
        oid: oid('33'),
        typeId: TYPE_OFS_DELTA,
        body: Buffer.alloc(0),
        delta: { base: oid('11'), data: delta(base.length, 4, copyWide(0, 4)) },
      },
    ])
    expect((await pack.read(oid('33')))?.body.toString()).toBe('the ')
  })

  it('applies a reference delta', async () => {
    const pack = await writePack([
      { oid: oid('11'), typeId: TYPE_BLOB, body: base },
      {
        oid: oid('22'),
        typeId: TYPE_REF_DELTA,
        body: Buffer.alloc(0),
        delta: { base: oid('11'), data: delta(base.length, 8, insert('a '), copyNarrow(10, 6)) },
      },
    ])
    expect((await pack.read(oid('22')))?.body.toString()).toBe('a brown ')
  })

  it('reports a reference delta whose base is in another pack', async () => {
    const pack = await writePack([
      {
        oid: oid('22'),
        typeId: TYPE_REF_DELTA,
        body: Buffer.alloc(0),
        delta: { base: oid('ee'), data: delta(1, 1, insert('a')) },
      },
    ])
    await expect(pack.read(oid('22'))).rejects.toThrow(/is not in this pack/)
  })

  it('reads a copy command with no size as a whole 64 KiB block', async () => {
    const large = Buffer.from('z'.repeat(0x10000 + 16))
    const pack = await writePack([
      { oid: oid('11'), typeId: TYPE_BLOB, body: large },
      {
        oid: oid('22'),
        typeId: TYPE_OFS_DELTA,
        body: Buffer.alloc(0),
        delta: { base: oid('11'), data: delta(large.length, 0x10000, copyWholeBlock(0)) },
      },
    ])
    expect((await pack.read(oid('22')))?.body.length).toBe(0x10000)
  })

  it('reads a copy that leaves out the offset bytes it does not need', async () => {
    const wide = Buffer.concat([noise(0x100), Buffer.from('tail'), noise(0x100)])
    const pack = await writePack([
      { oid: oid('11'), typeId: TYPE_BLOB, body: wide },
      {
        oid: oid('22'),
        typeId: TYPE_OFS_DELTA,
        body: Buffer.alloc(0),
        delta: { base: oid('11'), data: delta(wide.length, 4, copyHighOffset(0x100, 4)) },
      },
    ])
    expect((await pack.read(oid('22')))?.body.toString()).toBe('tail')
  })

  it('reads a copy whose offset needs the fourth byte', async () => {
    const wide = Buffer.concat([noise(0x1000), Buffer.from('tail')])
    const pack = await writePack([
      { oid: oid('11'), typeId: TYPE_BLOB, body: wide },
      {
        oid: oid('22'),
        typeId: TYPE_OFS_DELTA,
        body: Buffer.alloc(0),
        delta: { base: oid('11'), data: delta(wide.length, 4, copyWide(0x1000, 4)) },
      },
    ])
    expect((await pack.read(oid('22')))?.body.toString()).toBe('tail')
  })
})

describe('a delta that cannot be trusted', () => {
  const base = Buffer.from('the quick brown fox\n')

  async function deltaPack(data: Buffer): Promise<PackIndex> {
    return await writePack([
      { oid: oid('11'), typeId: TYPE_BLOB, body: base },
      {
        oid: oid('22'),
        typeId: TYPE_OFS_DELTA,
        body: Buffer.alloc(0),
        delta: { base: oid('11'), data },
      },
    ])
  }

  it('refuses a delta built against a base of another size', async () => {
    const pack = await deltaPack(delta(base.length + 1, 4, copyWide(0, 4)))
    await expect(pack.read(oid('22'))).rejects.toThrow(/expects a base of/)
  })

  it('refuses a delta that copies from beyond its base', async () => {
    const pack = await deltaPack(delta(base.length, 4, copyNarrow(200, 4)))
    await expect(pack.read(oid('22'))).rejects.toThrow(/beyond the end of its base/)
  })

  it('refuses a delta that writes past the size it declared', async () => {
    const pack = await deltaPack(delta(base.length, 4, copyWide(0, 8)))
    await expect(pack.read(oid('22'))).rejects.toThrow(/past the end of the object/)
  })

  it('refuses an insert that writes past the size it declared', async () => {
    const pack = await deltaPack(delta(base.length, 2, insert('four')))
    await expect(pack.read(oid('22'))).rejects.toThrow(/past the end of the object/)
  })

  it('refuses a delta that leaves the object half written', async () => {
    const pack = await deltaPack(delta(base.length, 12, copyWide(0, 4)))
    await expect(pack.read(oid('22'))).rejects.toThrow(/filled 4 of the 12 bytes/)
  })

  it('refuses a delta whose insert command inserts nothing', async () => {
    const pack = await deltaPack(delta(base.length, 4, Buffer.from([0])))
    await expect(pack.read(oid('22'))).rejects.toThrow(/zero-length insert/)
  })

  it('refuses a delta that ends in the middle of a command', async () => {
    const pack = await deltaPack(
      Buffer.concat([varint(base.length), varint(4), Buffer.from([0x81])]),
    )
    await expect(pack.read(oid('22'))).rejects.toThrow(/ends in the middle/)
  })

  it('refuses a varint that runs past what a number can hold', async () => {
    const pack = await deltaPack(
      Buffer.concat([Buffer.from(Array.from({ length: 12 }, () => 0xff))]),
    )
    await expect(pack.read(oid('22'))).rejects.toThrow(/out of range/)
  })

  it('refuses a delta chain deeper than git itself builds', async () => {
    const chain: Fixture[] = [{ oid: oid('ff'), typeId: TYPE_BLOB, body: base }]
    for (let link = 1; link <= 52; link += 1) {
      chain.push({
        oid: oid(link.toString(16).padStart(3, '0')),
        typeId: TYPE_OFS_DELTA,
        body: Buffer.alloc(0),
        delta: {
          base: chain[link - 1]?.oid ?? '',
          data: delta(base.length, base.length, copyWide(0, base.length)),
        },
      })
    }
    const pack = await writePack(chain)
    await expect(pack.read(chain.at(-1)?.oid ?? '')).rejects.toThrow(/deeper than 50/)
  })
})

describe('a record whose header is corrupt', () => {
  it('refuses a size that runs past what a number can hold', async () => {
    const idxPath = await writePackFiles(
      [{ oid: oid('11'), typeId: TYPE_BLOB, body: Buffer.from('a') }],
      root,
    )
    const packPath = idxPath.replace(/\.idx$/, '.pack')
    await writeFile(
      packPath,
      Buffer.concat([
        Buffer.from('PACK'),
        uint32(2),
        uint32(1),
        Buffer.from(Array.from({ length: 16 }, () => 0xff)),
      ]),
    )
    const pack = await PackIndex.open(idxPath)
    opened.push(pack)
    await expect(pack.read(oid('11'))).rejects.toThrow(/out of range/)
  })

  it('refuses a reference delta that ends before its base object id', async () => {
    const idxPath = await writePackFiles(
      [{ oid: oid('11'), typeId: TYPE_BLOB, body: Buffer.from('a') }],
      root,
    )
    const packPath = idxPath.replace(/\.idx$/, '.pack')
    await writeFile(
      packPath,
      Buffer.concat([Buffer.from('PACK'), uint32(2), uint32(1), Buffer.from([(7 << 4) | 1, 0x00])]),
    )
    const pack = await PackIndex.open(idxPath)
    opened.push(pack)
    await expect(pack.read(oid('11'))).rejects.toThrow(/before its base object id/)
  })

  it('refuses an offset delta that points before the start of the pack', async () => {
    const idxPath = await writePackFiles(
      [{ oid: oid('11'), typeId: TYPE_BLOB, body: Buffer.from('a') }],
      root,
    )
    const packPath = idxPath.replace(/\.idx$/, '.pack')
    await writeFile(
      packPath,
      Buffer.concat([
        Buffer.from('PACK'),
        uint32(2),
        uint32(1),
        Buffer.from([(6 << 4) | 1, 0xff, 0xff, 0xff, 0x7f]),
      ]),
    )
    const pack = await PackIndex.open(idxPath)
    opened.push(pack)
    await expect(pack.read(oid('11'))).rejects.toThrow(/before the start of the pack/)
  })
})

describe('a filesystem store reading a packed repository', () => {
  it('reads an object from a pack, and reports one that is in no pack', async () => {
    const gitdir = join(root, 'packed.git')
    const store = await FilesystemObjectStore.create(gitdir, { now: NOW })
    stores.push(store)
    const packed = Buffer.from('packed away\n')
    const object = serialiseObject('blob', packed)
    const packedOid = hashObject('blob', packed)
    await writePackFiles(
      [{ oid: packedOid, typeId: TYPE_BLOB, body: packed }],
      join(gitdir, 'objects', 'pack'),
    )
    expect(Buffer.from((await store.read(packedOid)) ?? [])).toEqual(object)
    expect(await store.has(packedOid)).toBe(true)
    expect(await store.read(oid('99'))).toBeNull()
  })
})
