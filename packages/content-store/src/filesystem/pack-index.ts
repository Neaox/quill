/**
 * Packfile reading: version 2 pack index plus the packfile itself, deltas
 * included.
 *
 * The store only ever writes loose objects, but packing is an operational
 * requirement (ADR-014) and an operator may run `git gc` at any time, so
 * everything the store wrote must still be readable once git has rewritten it
 * as deltas inside a packfile. Writing packfiles is deliberately not
 * implemented: remote sync does that with a real Git implementation.
 *
 * Memory is bounded on purpose. The index is held in memory, because binary
 * search over it is the whole point of an index and it costs 26 bytes per
 * object; the packfile — which is the large half, and unbounded — is never
 * read whole. Each record is inflated from a window read positionally through
 * an open file handle, so reading one object out of a gigabyte pack costs a
 * few reads rather than a gigabyte of resident memory. A pack index owns that
 * handle, so whoever opened it must {@link PackIndex.close} it.
 *
 * Everything read here is data an operator's `git gc` wrote, but a packfile is
 * also just bytes on a disk that can be truncated or corrupted, so every
 * variable-length encoding is bounded and every delta is checked against the
 * sizes it declares rather than trusted to fill its buffer.
 */

import { open, readFile, type FileHandle } from 'node:fs/promises'
import { promisify } from 'node:util'
import { inflate } from 'node:zlib'
import { GitObjectError, type GitObject, type GitObjectType } from '../git/objects.ts'

const inflateAsync = promisify(inflate)

const IDX_MAGIC = 0xff744f63
const IDX_VERSION = 2
const FANOUT_OFFSET = 8
const OID_BYTES = 20
const LARGE_OFFSET_FLAG = 0x80000000
const IDX_TRAILER_BYTES = 40

/** Enough for a type byte, the longest size varint, and a base reference. */
const RECORD_HEADER_BYTES = 64

/**
 * The first window a record's compressed data is read through. It doubles
 * until the stream ends inside it, and never exceeds what is left of the file,
 * so the window is bounded by the record's own compressed length.
 */
const INITIAL_WINDOW = 64 * 1024

/** A size no varint may exceed, because a Number stops being exact past it. */
const MAX_SIZE_SHIFT = 53

/**
 * How many deltas may stand between an object and a full copy of it. git's own
 * packer defaults to 50, so a deeper chain is a corrupt or hostile pack, not
 * one `git gc` wrote.
 */
const MAX_DELTA_DEPTH = 50

type PackedType = GitObjectType | 'ofs-delta' | 'ref-delta'

function packedType(id: number): PackedType {
  switch (id) {
    case 1:
      return 'commit'
    case 2:
      return 'tree'
    case 3:
      return 'blob'
    case 4:
      return 'tag'
    case 6:
      return 'ofs-delta'
    case 7:
      return 'ref-delta'
    default:
      throw new GitObjectError(`Unsupported packed object type ${id}`)
  }
}

/** A byte cursor, so the variable-length encodings can share one position. */
class Cursor {
  position: number

  constructor(position: number) {
    this.position = position
  }

  next(bytes: Buffer): number {
    if (this.position >= bytes.length) {
      throw new GitObjectError('Packed record ends in the middle of an encoding')
    }
    const byte = bytes.readUInt8(this.position)
    this.position += 1
    return byte
  }
}

/** A little-endian continuation-bit integer, bounded so it stays exact. */
function readVarint(cursor: Cursor, bytes: Buffer): number {
  let value = 0
  let shift = 0
  let byte: number
  do {
    byte = cursor.next(bytes)
    value += (byte & 0x7f) * 2 ** shift
    shift += 7
    if (shift > MAX_SIZE_SHIFT) throw new GitObjectError('Packed size is out of range')
  } while ((byte & 0x80) !== 0)
  return value
}

export class PackIndex {
  readonly #idx: Buffer
  readonly #pack: FileHandle
  readonly #packBytes: number
  readonly #count: number
  readonly #oidStart: number
  readonly #offsetStart: number

  private constructor(idx: Buffer, pack: FileHandle, packBytes: number) {
    this.#idx = idx
    this.#pack = pack
    this.#packBytes = packBytes
    this.#count = idx.readUInt32BE(FANOUT_OFFSET + 255 * 4)
    this.#oidStart = FANOUT_OFFSET + 256 * 4
    this.#offsetStart = this.#oidStart + this.#count * (OID_BYTES + 4)
  }

  static async open(idxPath: string): Promise<PackIndex> {
    const idx = await readFile(idxPath)
    if (idx.length < FANOUT_OFFSET + 256 * 4) {
      throw new GitObjectError(`${idxPath}: pack index is too short to hold a fanout table`)
    }
    if (idx.readUInt32BE(0) !== IDX_MAGIC || idx.readUInt32BE(4) !== IDX_VERSION) {
      throw new GitObjectError(`${idxPath}: only version 2 pack indexes are supported`)
    }
    const count = idx.readUInt32BE(FANOUT_OFFSET + 255 * 4)
    if (idx.length < FANOUT_OFFSET + 256 * 4 + count * (OID_BYTES + 8) + IDX_TRAILER_BYTES) {
      throw new GitObjectError(`${idxPath}: pack index is shorter than the objects it declares`)
    }
    const pack = await open(idxPath.replace(/\.idx$/, '.pack'), 'r')
    return new PackIndex(idx, pack, (await pack.stat()).size)
  }

  /** Release the packfile handle. A closed index must not be read again. */
  async close(): Promise<void> {
    await this.#pack.close()
  }

  /** Whether this pack holds the object, without reading or inflating it. */
  has(oid: string): boolean {
    return this.#find(oid) !== -1
  }

  /** The object's type and body, or null when this pack does not hold it. */
  async read(oid: string): Promise<GitObject | null> {
    const position = this.#find(oid)
    return position === -1 ? null : await this.#readAt(this.#offsetAt(position), 0)
  }

  /** Binary search within the fanout bucket for the oid's first byte. */
  #find(oid: string): number {
    const target = Buffer.from(oid, 'hex')
    if (target.length !== OID_BYTES) return -1
    const bucket = target.readUInt8(0)
    let low = bucket === 0 ? 0 : this.#idx.readUInt32BE(FANOUT_OFFSET + (bucket - 1) * 4)
    let high = this.#idx.readUInt32BE(FANOUT_OFFSET + bucket * 4)
    while (low < high) {
      const middle = (low + high) >> 1
      const at = this.#oidStart + middle * OID_BYTES
      // Buffer.compare's receiver is the source, so a negative result means the
      // indexed entry sorts before the target.
      const order = this.#idx.compare(target, 0, OID_BYTES, at, at + OID_BYTES)
      if (order === 0) return middle
      if (order < 0) low = middle + 1
      else high = middle
    }
    return -1
  }

  #offsetAt(position: number): number {
    const offset = this.#idx.readUInt32BE(this.#offsetStart + position * 4)
    if ((offset & LARGE_OFFSET_FLAG) === 0) return offset
    const large = this.#offsetStart + this.#count * 4 + (offset & ~LARGE_OFFSET_FLAG) * 8
    return Number(this.#idx.readBigUInt64BE(large))
  }

  async #readAt(offset: number, depth: number): Promise<GitObject> {
    if (depth > MAX_DELTA_DEPTH) {
      throw new GitObjectError(`Delta chain is deeper than ${MAX_DELTA_DEPTH} objects`)
    }
    const header = await this.#readPack(offset, RECORD_HEADER_BYTES)
    const cursor = new Cursor(0)
    let byte = cursor.next(header)
    const type = packedType((byte >> 4) & 0b111)
    let size = byte & 0b1111
    let shift = 4
    while ((byte & 0x80) !== 0) {
      byte = cursor.next(header)
      size += (byte & 0x7f) * 2 ** shift
      shift += 7
      if (shift > MAX_SIZE_SHIFT) throw new GitObjectError('Packed size is out of range')
    }
    if (type === 'ofs-delta' || type === 'ref-delta') {
      const baseOffset = this.#baseOffset(type, cursor, offset, header)
      const delta = await this.#inflateAt(offset + cursor.position, size)
      const base = await this.#readAt(baseOffset, depth + 1)
      return { type: base.type, body: applyDelta(delta, base.body) }
    }
    return { type, body: await this.#inflateAt(offset + cursor.position, size) }
  }

  #baseOffset(
    type: 'ofs-delta' | 'ref-delta',
    cursor: Cursor,
    offset: number,
    header: Buffer,
  ): number {
    if (type === 'ref-delta') {
      if (cursor.position + OID_BYTES > header.length) {
        throw new GitObjectError('Reference delta ends before its base object id')
      }
      const oid = header.subarray(cursor.position, cursor.position + OID_BYTES).toString('hex')
      cursor.position += OID_BYTES
      const position = this.#find(oid)
      if (position === -1) throw new GitObjectError(`Delta base ${oid} is not in this pack`)
      return this.#offsetAt(position)
    }
    let byte = cursor.next(header)
    let distance = byte & 0x7f
    while ((byte & 0x80) !== 0) {
      byte = cursor.next(header)
      distance = (distance + 1) * 128 + (byte & 0x7f)
      if (distance > offset)
        throw new GitObjectError('Delta base lies before the start of the pack')
    }
    return offset - distance
  }

  /**
   * Inflate one record, reading through a window that doubles until the stream
   * ends inside it. zlib stops at the end of its own stream, so the records
   * that follow in the window are ignored.
   */
  async #inflateAt(position: number, size: number): Promise<Buffer> {
    const remaining = this.#packBytes - position
    for (let window = INITIAL_WINDOW; ; window *= 2) {
      const length = Math.min(window, remaining)
      const chunk = await this.#readPack(position, length)
      try {
        return await inflateAsync(chunk, { maxOutputLength: size + 1 })
      } catch (error) {
        // Once the window reaches the end of the pack a bigger one would read
        // the same bytes, so the record itself is corrupt or truncated.
        if (length === remaining) {
          throw new GitObjectError(
            `Packed record at ${position} could not be inflated: ${String(error)}`,
          )
        }
      }
    }
  }

  async #readPack(position: number, length: number): Promise<Buffer> {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await this.#pack.read(buffer, 0, length, position)
    return buffer.subarray(0, bytesRead)
  }
}

/**
 * Apply a git delta: a size header, then copy-from-base and insert commands.
 *
 * Every command is checked against the declared sizes before it writes, and
 * the result has to be exactly as long as the delta said it would be. A delta
 * that overruns, underfills, or copies from outside its base is a corrupt
 * pack, and the difference between reporting that and handing back a buffer of
 * uninitialised memory is the reason this allocates with `Buffer.alloc`.
 */
function applyDelta(delta: Buffer, base: Buffer): Buffer {
  const cursor = new Cursor(0)
  const declaredBase = readVarint(cursor, delta)
  if (declaredBase !== base.length) {
    throw new GitObjectError(`Delta expects a base of ${declaredBase} bytes, not ${base.length}`)
  }
  const target = readVarint(cursor, delta)
  const out = Buffer.alloc(target)
  let written = 0
  while (cursor.position < delta.length) {
    const command = cursor.next(delta)
    if ((command & 0x80) !== 0) {
      let from = 0
      let length = 0
      if ((command & 0x01) !== 0) from |= cursor.next(delta)
      if ((command & 0x02) !== 0) from |= cursor.next(delta) << 8
      if ((command & 0x04) !== 0) from |= cursor.next(delta) << 16
      if ((command & 0x08) !== 0) from += cursor.next(delta) * 2 ** 24
      if ((command & 0x10) !== 0) length |= cursor.next(delta)
      if ((command & 0x20) !== 0) length |= cursor.next(delta) << 8
      if ((command & 0x40) !== 0) length |= cursor.next(delta) << 16
      if (length === 0) length = 0x10000
      if (from + length > base.length) {
        throw new GitObjectError('Delta copies from beyond the end of its base')
      }
      written += copy(base, out, written, from, length, target)
    } else {
      if (command === 0) throw new GitObjectError('Delta has a zero-length insert command')
      written += copy(delta, out, written, cursor.position, command, target)
      cursor.position += command
    }
  }
  if (written !== target) {
    throw new GitObjectError(`Delta filled ${written} of the ${target} bytes it declared`)
  }
  return out
}

function copy(
  source: Buffer,
  out: Buffer,
  written: number,
  from: number,
  length: number,
  target: number,
): number {
  if (written + length > target) {
    throw new GitObjectError('Delta writes past the end of the object it declared')
  }
  return source.copy(out, written, from, from + length)
}
