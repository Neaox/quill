import { concatChunks } from '../ports/blob-store.ts'

/**
 * Reading an image container's bytes as they arrive.
 *
 * Every raster format the platform accepts is a sequence of framed parts —
 * PNG chunks, JPEG segments, GIF blocks, RIFF chunks, ISO base media boxes —
 * and walking one means reading a small header, deciding, and then either
 * copying or skipping a run of bytes whose length the header stated. The
 * network hands those bytes over in chunks that have nothing to do with the
 * frames, so this class is the seam between the two: it holds only what a
 * decision needs, and passes everything else straight through.
 */
export class ByteSource {
  private readonly iterator: AsyncIterator<Uint8Array>
  /** Chunks pulled and not yet consumed, first to be read first. */
  private pending: Uint8Array[] = []

  constructor(chunks: AsyncIterable<Uint8Array>) {
    this.iterator = chunks[Symbol.asyncIterator]()
  }

  /** The next non-empty chunk, or `null` once there are no more. */
  async pull(): Promise<Uint8Array | null> {
    for (;;) {
      const held = this.pending.shift()
      if (held !== undefined) return held
      const { done, value } = await this.iterator.next()
      if (done) return null
      if (value.length > 0) return value
    }
  }

  /** Hands non-empty bytes back, to be read again before anything else. */
  unread(chunk: Uint8Array): void {
    this.pending.unshift(chunk)
  }

  /** Exactly `count` bytes in one buffer, or a refusal if the file ends first. */
  async take(count: number): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    let collected = 0
    while (collected < count) {
      const chunk = await this.pull()
      if (chunk === null) throw new ContainerFault('the file ends before it should')
      const needed = count - collected
      if (chunk.length > needed) {
        parts.push(chunk.subarray(0, needed))
        this.unread(chunk.subarray(needed))
        collected = count
      } else {
        parts.push(chunk)
        collected += chunk.length
      }
    }
    return parts.length === 1 ? (parts[0] as Uint8Array) : concatChunks(parts)
  }

  /** The next `count` bytes as they arrive, or a refusal if the file ends first. */
  async *pass(count: number): AsyncGenerator<Uint8Array> {
    let remaining = count
    while (remaining > 0) {
      const chunk = await this.pull()
      if (chunk === null) throw new ContainerFault('the file ends before it should')
      if (chunk.length > remaining) {
        yield chunk.subarray(0, remaining)
        this.unread(chunk.subarray(remaining))
        return
      }
      yield chunk
      remaining -= chunk.length
    }
  }

  async skip(count: number): Promise<void> {
    const chunks = this.pass(count)
    while (!(await chunks.next()).done) {
      // Read and dropped.
    }
  }

  /** Everything that is left, in one buffer. */
  async rest(): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    for (let chunk = await this.pull(); chunk !== null; chunk = await this.pull()) parts.push(chunk)
    return concatChunks(parts)
  }

  /**
   * Reads to the end and keeps none of it.
   *
   * A walker calls this once it has passed the end of the image, so that the
   * size cap upstream sees every byte that was sent, whatever followed the
   * picture.
   */
  async drain(): Promise<void> {
    while ((await this.pull()) !== null) {
      // Read and dropped.
    }
  }
}

/**
 * The bytes are not a container this platform can walk: cut short, framed
 * wrongly, or pointing outside themselves. Thrown by the source and by every
 * walker; `image-metadata.ts` turns it into a `ContainerFault` that names the
 * format being read, which is what the upload's refusal reports.
 */
export class ContainerFault extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ContainerFault'
  }
}

export function readUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number)
}

export function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] as number) << 24) |
      ((bytes[offset + 1] as number) << 16) |
      ((bytes[offset + 2] as number) << 8) |
      (bytes[offset + 3] as number)) >>>
    0
  )
}

export function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset + 3] as number) << 24) |
      ((bytes[offset + 2] as number) << 16) |
      ((bytes[offset + 1] as number) << 8) |
      (bytes[offset] as number)) >>>
    0
  )
}

export function writeUint32LittleEndian(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24])
}

/** The ASCII in a byte range, for the four-character tags every container here uses. */
export function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}
