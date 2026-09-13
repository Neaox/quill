import { ascii, ContainerFault, readUint16, readUint32 } from './image-container.ts'

/**
 * An AVIF with its EXIF and XMP items removed (`image-metadata.ts`).
 *
 * An AVIF is an ISO base media file: a `meta` box holding tables that
 * describe *items* — the picture, and beside it any EXIF block or XMP packet
 * — and an `mdat` box holding their bytes at the file offsets the tables
 * state. Taking the metadata out therefore means taking the items out of
 * every table that names them (`iinf`, `iloc`, `iref`, `ipma`), taking their
 * bytes out of the file, and then restating where everything that remains
 * now lies, because removing bytes moves whatever followed them.
 *
 * The rewrite works from a buffer, in two passes over one output: the boxes
 * are laid out first, with the location table written in its final size but
 * with its offsets blank; then, with every kept byte's new position known, the
 * offsets are filled in. A location that points at bytes the file no longer
 * has — or never had — is a malformed file, not a guess.
 */
export function rewriteAvif(file: Uint8Array): Uint8Array {
  const top = boxesIn(file, 0, file.length)
  const meta = top.find((box) => box.type === 'meta')
  if (meta === undefined) throw new ContainerFault('no meta box')
  const children = boxesIn(file, meta.payloadStart + FULL_BOX_HEADER, meta.end)
  const iinf = children.find((box) => box.type === 'iinf')
  const iloc = children.find((box) => box.type === 'iloc')
  if (iinf === undefined || iloc === undefined) throw new ContainerFault('no item tables')

  const items = readItems(file, iinf)
  const dropped = new Set(items.filter(isMetadataItem).map((item) => item.id))
  const locations = readLocations(file, iloc)
  const idat = children.find((box) => box.type === 'idat')
  const removed = droppedRanges(file, locations, dropped, idat)

  const output = new Output(file)
  const patches: Patch[] = []
  for (const box of top) {
    if (box.type === 'free' || box.type === 'skip') continue
    if (box.type === 'meta') {
      writeMeta(output, meta, children, { items, locations, dropped, removed, idat, patches })
      continue
    }
    output.header(box, output.payloadWithout(box, removed, 'remove'))
  }
  for (const patch of patches) patch(output)
  return output.bytes()
}

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

interface Box {
  readonly type: string
  readonly start: number
  readonly payloadStart: number
  readonly end: number
  /** A 16-byte header carrying a 64-bit size. */
  readonly largeSize: boolean
  /** A size of zero: the box runs to the end of the file. */
  readonly toEnd: boolean
}

const BOX_HEADER = 8
const LARGE_BOX_HEADER = 16
/** Version and flags, at the head of a "full" box's payload. */
const FULL_BOX_HEADER = 4

function boxesIn(file: Uint8Array, start: number, end: number): Box[] {
  const found: Box[] = []
  for (let offset = start; offset < end;) {
    if (offset + BOX_HEADER > end) throw new ContainerFault('a box header past the end')
    let size = readUint32(file, offset)
    let header = BOX_HEADER
    const largeSize = size === 1
    const toEnd = size === 0
    if (largeSize) {
      if (offset + LARGE_BOX_HEADER > end) throw new ContainerFault('a box header past the end')
      size = readUint64(file, offset + BOX_HEADER)
      header = LARGE_BOX_HEADER
    } else if (toEnd) {
      size = end - offset
    }
    if (size < header || offset + size > end) throw new ContainerFault('a box overruns its parent')
    found.push({
      type: ascii(file, offset + 4, offset + 8),
      start: offset,
      payloadStart: offset + header,
      end: offset + size,
      largeSize,
      toEnd,
    })
    offset += size
  }
  return found
}

function readUint64(file: Uint8Array, offset: number): number {
  return Number(new DataView(file.buffer, file.byteOffset, file.byteLength).getBigUint64(offset))
}

/** A bounded reader over one box's payload; reading past the box is a malformed file. */
class Cursor {
  private readonly file: Uint8Array
  private readonly end: number
  offset: number

  constructor(file: Uint8Array, start: number, end: number) {
    this.file = file
    this.offset = start
    this.end = end
  }

  /** An unsigned big-endian integer of 0, 1, 2, 4 or 8 bytes; a width of 0 reads as 0. */
  uint(size: number): number {
    if (this.offset + size > this.end)
      throw new ContainerFault('a table ends before its last field')
    const at = this.offset
    this.offset += size
    switch (size) {
      case 0:
        return 0
      case 1:
        return this.file[at] as number
      case 2:
        return readUint16(this.file, at)
      case 4:
        return readUint32(this.file, at)
      case 8:
        return readUint64(this.file, at)
      default:
        throw new ContainerFault('a field width the format does not allow')
    }
  }

  /** A null-terminated string, consumed with its terminator. */
  string(): string {
    const terminator = this.file.subarray(this.offset, this.end).indexOf(0)
    if (terminator === -1) throw new ContainerFault('a string with no end')
    const text = ascii(this.file, this.offset, this.offset + terminator)
    this.offset += terminator + 1
    return text
  }
}

// ---------------------------------------------------------------------------
// Item tables, read
// ---------------------------------------------------------------------------

interface Item {
  readonly id: number
  readonly type: string
  /** For a `mime` item, what it says it is. */
  readonly contentType: string | null
  readonly box: Box
}

function isMetadataItem(item: Item): boolean {
  return item.type === 'Exif' || (item.type === 'mime' && item.contentType === XMP_CONTENT_TYPE)
}

const XMP_CONTENT_TYPE = 'application/rdf+xml'

/** The `iinf` box's entry count is 16 bits in version 0 and 32 bits after. */
function itemCountSize(version: number): number {
  return version === 0 ? 2 : 4
}

function readItems(file: Uint8Array, iinf: Box): Item[] {
  const version = file[iinf.payloadStart] as number
  const entries = iinf.payloadStart + FULL_BOX_HEADER + itemCountSize(version)
  return boxesIn(file, entries, iinf.end).map((box) => {
    if (box.type !== 'infe') throw new ContainerFault('an item table holding something else')
    const entryVersion = file[box.payloadStart] as number
    // Versions 0 and 1 have no item type at all; the format requires 2 or 3.
    if (entryVersion < 2) throw new ContainerFault('an item entry older than the format allows')
    const cursor = new Cursor(file, box.payloadStart + FULL_BOX_HEADER, box.end)
    const id = cursor.uint(entryVersion === 2 ? 2 : 4)
    cursor.uint(2) // item protection index
    const type = ascii(file, cursor.offset, cursor.offset + 4)
    cursor.offset += 4
    cursor.string() // item name
    return { id, type, contentType: type === 'mime' ? cursor.string() : null, box }
  })
}

interface Extent {
  readonly index: number
  readonly offset: number
  readonly length: number
}

interface Location {
  readonly id: number
  /** 0: offsets are file positions; 1: offsets are into `idat`; 2: into another item. */
  readonly method: number
  readonly dataReference: number
  readonly base: number
  readonly extents: readonly Extent[]
}

interface LocationTable {
  readonly version: number
  readonly flags: Uint8Array
  readonly offsetSize: number
  readonly lengthSize: number
  readonly baseOffsetSize: number
  readonly indexSize: number
  readonly entries: readonly Location[]
}

/** Item ids and the entry count are 16 bits before version 2 and 32 bits from it. */
function locationIdSize(version: number): number {
  return version < 2 ? 2 : 4
}

function readLocations(file: Uint8Array, iloc: Box): LocationTable {
  const version = file[iloc.payloadStart] as number
  const flags = file.subarray(iloc.payloadStart + 1, iloc.payloadStart + FULL_BOX_HEADER)
  const cursor = new Cursor(file, iloc.payloadStart + FULL_BOX_HEADER, iloc.end)
  const sizes = cursor.uint(2)
  const offsetSize = sizes >>> 12
  const lengthSize = (sizes >>> 8) & 0xf
  const baseOffsetSize = (sizes >>> 4) & 0xf
  const indexSize = version === 0 ? 0 : sizes & 0xf
  const idSize = locationIdSize(version)
  const count = cursor.uint(idSize)
  const entries: Location[] = []
  for (let i = 0; i < count; i += 1) {
    const id = cursor.uint(idSize)
    const method = version === 0 ? 0 : cursor.uint(2) & 0xf
    const dataReference = cursor.uint(2)
    const base = cursor.uint(baseOffsetSize)
    const extentCount = cursor.uint(2)
    const extents: Extent[] = []
    for (let e = 0; e < extentCount; e += 1) {
      const index = cursor.uint(indexSize)
      const offset = cursor.uint(offsetSize)
      const length = cursor.uint(lengthSize)
      extents.push({ index, offset, length })
    }
    entries.push({ id, method, dataReference, base, extents })
  }
  return { version, flags, offsetSize, lengthSize, baseOffsetSize, indexSize, entries }
}

// ---------------------------------------------------------------------------
// Which bytes go
// ---------------------------------------------------------------------------

interface Range {
  readonly start: number
  readonly end: number
}

/**
 * The file positions of every dropped item's bytes, as ranges to take out of
 * the box that holds them, or to blank when they lie inside `idat` — which
 * sits inside the tables themselves, where nothing can be allowed to move.
 */
function droppedRanges(
  file: Uint8Array,
  locations: LocationTable,
  dropped: ReadonlySet<number>,
  idat: Box | undefined,
): Range[] {
  const ranges: Range[] = []
  for (const entry of locations.entries) {
    if (!dropped.has(entry.id)) continue
    for (const extent of entry.extents) {
      const range = extentRange(file, entry, extent, idat)
      if (range !== null) ranges.push(range)
    }
  }
  return ranges.toSorted((a, b) => a.start - b.start)
}

/** Where an extent's bytes are in the file, or `null` for one that has no bytes of its own. */
function extentRange(
  file: Uint8Array,
  entry: Location,
  extent: Extent,
  idat: Box | undefined,
): Range | null {
  if (entry.dataReference !== 0) throw new ContainerFault('an item stored in another file')
  if (entry.method === 2) return null
  if (entry.method === 1) {
    if (idat === undefined) throw new ContainerFault('an item in an idat the file lacks')
    const start = idat.payloadStart + entry.base + extent.offset
    return { start, end: extent.length === 0 ? idat.end : start + extent.length }
  }
  const start = entry.base + extent.offset
  return { start, end: extent.length === 0 ? file.length : start + extent.length }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

interface Copied {
  readonly oldStart: number
  readonly oldEnd: number
  readonly newStart: number
}

/**
 * The file being written, as a list of parts: runs copied from the old file,
 * which remember where they came from, and parts written fresh. The copies
 * are what turn an old position into a new one once everything is laid out.
 */
class Output {
  readonly file: Uint8Array
  private readonly parts: Uint8Array[] = []
  private readonly copies: Copied[] = []
  length = 0

  constructor(file: Uint8Array) {
    this.file = file
  }

  copy(start: number, end: number): void {
    if (end <= start) return
    this.copies.push({ oldStart: start, oldEnd: end, newStart: this.length })
    this.parts.push(this.file.subarray(start, end))
    this.length += end - start
  }

  /** Bytes written fresh; answers where they begin, for a patch to find them. */
  add(bytes: Uint8Array): number {
    const at = this.length
    this.parts.push(bytes)
    this.length += bytes.length
    return at
  }

  /**
   * A box header for a payload of the given length, keeping the shape of the
   * original: wide if it was wide, open-ended if it was open-ended. Then the
   * payload's parts.
   */
  header(box: Box, payload: () => void): void {
    const headerLength = box.largeSize ? LARGE_BOX_HEADER : BOX_HEADER
    const header = new Uint8Array(headerLength)
    header.set(this.file.subarray(box.start + 4, box.start + 8), 4)
    const at = this.add(header)
    payload()
    const size = this.length - at
    const view = new DataView(header.buffer)
    if (box.largeSize) {
      view.setUint32(0, 1)
      view.setBigUint64(BOX_HEADER, BigInt(size))
    } else if (!box.toEnd) {
      view.setUint32(0, size)
    }
  }

  /**
   * A box's payload with the dropped ranges inside it taken out, or blanked.
   * A range that crosses the box's edge belongs to no box, which no writer
   * produces.
   */
  payloadWithout(box: Box, ranges: readonly Range[], mode: 'remove' | 'blank'): () => void {
    return () => {
      let at = box.payloadStart
      for (const range of ranges) {
        if (range.end <= box.payloadStart || range.start >= box.end) continue
        if (range.start < at || range.end > box.end) {
          throw new ContainerFault('an item that crosses a box boundary')
        }
        this.copy(at, range.start)
        if (mode === 'blank') this.add(new Uint8Array(range.end - range.start))
        at = range.end
      }
      this.copy(at, box.end)
    }
  }

  /** The new position of a range of kept bytes, which must still be in one piece. */
  map(range: Range): number {
    const copied = this.copies.find((c) => c.oldStart <= range.start && range.start < c.oldEnd)
    if (copied === undefined || range.end > copied.oldEnd) {
      throw new ContainerFault('a location pointing at bytes the file does not keep')
    }
    return copied.newStart + (range.start - copied.oldStart)
  }

  bytes(): Uint8Array {
    const all = new Uint8Array(this.length)
    let offset = 0
    for (const part of this.parts) {
      all.set(part, offset)
      offset += part.length
    }
    return all
  }
}

/** Something to do once every part is in place and old positions can be mapped. */
type Patch = (output: Output) => void

// ---------------------------------------------------------------------------
// The meta box, rewritten
// ---------------------------------------------------------------------------

interface MetaRewrite {
  readonly items: readonly Item[]
  readonly locations: LocationTable
  readonly dropped: ReadonlySet<number>
  readonly removed: readonly Range[]
  readonly idat: Box | undefined
  readonly patches: Patch[]
}

function writeMeta(
  output: Output,
  meta: Box,
  children: readonly Box[],
  rewrite: MetaRewrite,
): void {
  output.header(meta, () => {
    output.copy(meta.payloadStart, meta.payloadStart + FULL_BOX_HEADER)
    for (const child of children) {
      switch (child.type) {
        case 'iinf':
          writeItems(output, child, rewrite)
          break
        case 'iloc':
          writeLocations(output, child, rewrite)
          break
        case 'iref':
          writeReferences(output, child, rewrite.dropped)
          break
        case 'iprp':
          writeProperties(output, child, rewrite.dropped)
          break
        case 'idat':
          output.header(child, output.payloadWithout(child, rewrite.removed, 'blank'))
          break
        default:
          if (rewrite.removed.some((range) => range.start < child.end && range.end > child.start)) {
            throw new ContainerFault('an item stored inside the tables')
          }
          output.copy(child.start, child.end)
      }
    }
  })
}

function writeItems(output: Output, iinf: Box, { items, dropped }: MetaRewrite): void {
  const version = output.file[iinf.payloadStart] as number
  const kept = items.filter((item) => !dropped.has(item.id))
  output.header(iinf, () => {
    output.copy(iinf.payloadStart, iinf.payloadStart + FULL_BOX_HEADER)
    output.add(uintBytes(itemCountSize(version), kept.length))
    for (const item of kept) output.copy(item.box.start, item.box.end)
  })
}

function writeLocations(output: Output, iloc: Box, rewrite: MetaRewrite): void {
  const { locations, dropped, idat, patches } = rewrite
  const { version, offsetSize, lengthSize, baseOffsetSize, indexSize } = locations
  const idSize = locationIdSize(version)
  const kept = locations.entries.filter((entry) => !dropped.has(entry.id))
  const fields: Uint8Array[] = [
    Uint8Array.from([version]),
    locations.flags,
    Uint8Array.from([(offsetSize << 4) | lengthSize, (baseOffsetSize << 4) | indexSize]),
    uintBytes(idSize, kept.length),
  ]
  // Where, in the bytes being assembled, each position field lies, and what
  // old position it must come to state.
  const pending: { at: number; size: number; entry: Location; offset: number }[] = []
  let length = fields.reduce((sum, field) => sum + field.length, 0)
  const push = (bytes: Uint8Array): number => {
    fields.push(bytes)
    length += bytes.length
    return length - bytes.length
  }
  for (const entry of kept) {
    push(uintBytes(idSize, entry.id))
    if (version !== 0) push(uintBytes(2, entry.method))
    push(uintBytes(2, entry.dataReference))
    const first = entry.extents[0]
    // With no offset field, the base is the position; otherwise the base is
    // folded into each extent's offset, so that every extent moves on its own.
    const baseAt = push(uintBytes(baseOffsetSize, 0))
    if (offsetSize === 0 && first !== undefined) {
      pending.push({ at: baseAt, size: baseOffsetSize, entry, offset: first.offset })
    }
    push(uintBytes(2, entry.extents.length))
    for (const extent of entry.extents) {
      push(uintBytes(indexSize, extent.index))
      const at = push(uintBytes(offsetSize, 0))
      if (offsetSize !== 0) pending.push({ at, size: offsetSize, entry, offset: extent.offset })
      push(uintBytes(lengthSize, extent.length))
    }
  }
  const table = new Uint8Array(length)
  let offset = 0
  for (const field of fields) {
    table.set(field, offset)
    offset += field.length
  }
  output.header(iloc, () => {
    output.add(table)
  })
  patches.push(() => {
    const { file } = output
    for (const { at, size, entry, offset: extentOffset } of pending) {
      const extent = { index: 0, offset: extentOffset, length: 0 }
      const range = extentRange(file, entry, extent, idat)
      /* v8 ignore next -- method 2 extents have no position field to patch. */
      if (range === null) continue
      const position = output.map({ start: range.start, end: range.start })
      table.set(uintBytes(size, position - origin(output, entry, idat)), at)
    }
  })
}

/**
 * What an item's offsets are measured from once the file is rewritten: the
 * start of `idat`'s payload for an item stored there, the file for the rest.
 */
function origin(output: Output, entry: Location, idat: Box | undefined): number {
  if (entry.method !== 1) return 0
  const { payloadStart } = idat as Box
  return output.map({ start: payloadStart, end: payloadStart })
}

function writeReferences(output: Output, iref: Box, dropped: ReadonlySet<number>): void {
  const { file } = output
  const version = file[iref.payloadStart] as number
  const idSize = version === 0 ? 2 : 4
  const kept: Uint8Array[] = []
  for (const reference of boxesIn(file, iref.payloadStart + FULL_BOX_HEADER, iref.end)) {
    const cursor = new Cursor(file, reference.payloadStart, reference.end)
    const from = cursor.uint(idSize)
    if (dropped.has(from)) continue
    const count = cursor.uint(2)
    const to = Array.from({ length: count }, () => cursor.uint(idSize)).filter(
      (id) => !dropped.has(id),
    )
    if (to.length === 0) continue
    kept.push(
      concat([
        uintBytes(4, BOX_HEADER + idSize + 2 + to.length * idSize),
        file.subarray(reference.start + 4, reference.start + 8),
        uintBytes(idSize, from),
        uintBytes(2, to.length),
        ...to.map((id) => uintBytes(idSize, id)),
      ]),
    )
  }
  if (kept.length === 0) return
  output.header(iref, () => {
    output.copy(iref.payloadStart, iref.payloadStart + FULL_BOX_HEADER)
    for (const reference of kept) output.add(reference)
  })
}

function writeProperties(output: Output, iprp: Box, dropped: ReadonlySet<number>): void {
  const { file } = output
  output.header(iprp, () => {
    for (const child of boxesIn(file, iprp.payloadStart, iprp.end)) {
      if (child.type === 'ipma') writeAssociations(output, child, dropped)
      else output.copy(child.start, child.end)
    }
  })
}

function writeAssociations(output: Output, ipma: Box, dropped: ReadonlySet<number>): void {
  const { file } = output
  const version = file[ipma.payloadStart] as number
  const wideIndexes = ((file[ipma.payloadStart + 3] as number) & 1) === 1
  const idSize = version === 0 ? 2 : 4
  const cursor = new Cursor(file, ipma.payloadStart + FULL_BOX_HEADER, ipma.end)
  const count = cursor.uint(4)
  const kept: Uint8Array[] = []
  for (let i = 0; i < count; i += 1) {
    const start = cursor.offset
    const id = cursor.uint(idSize)
    const associations = cursor.uint(1)
    cursor.offset += associations * (wideIndexes ? 2 : 1)
    if (cursor.offset > ipma.end) throw new ContainerFault('a table ends before its last field')
    if (!dropped.has(id)) kept.push(file.subarray(start, cursor.offset))
  }
  output.header(ipma, () => {
    output.copy(ipma.payloadStart, ipma.payloadStart + FULL_BOX_HEADER)
    output.add(uintBytes(4, kept.length))
    for (const entry of kept) output.add(entry)
  })
}

/** A big-endian unsigned integer in `size` bytes (0, 2, 4 or 8); a width of 0 is no bytes. */
function uintBytes(size: number, value: number): Uint8Array {
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  if (size === 8) view.setBigUint64(0, BigInt(value))
  else if (size === 4) view.setUint32(0, value)
  else if (size === 2) view.setUint16(0, value)
  return out
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    all.set(part, offset)
    offset += part.length
  }
  return all
}
