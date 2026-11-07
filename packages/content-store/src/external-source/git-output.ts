/**
 * Readers for the machine formats the `git` CLI writes: NUL-terminated
 * fields (`-z`), and the object stream of `git cat-file --batch`.
 *
 * Both read the output as it arrives and hold only what one record needs, so
 * a listing of a large tree or a read of many files never sits in memory
 * whole.
 */

const NUL = 0x00
const LINE_FEED = 0x0a

/** Each NUL-terminated field, decoded as UTF-8 once it is complete. */
export async function* nulFields(chunks: AsyncIterable<Buffer>): AsyncGenerator<string> {
  let pending = Buffer.alloc(0)
  for await (const chunk of chunks) {
    pending = Buffer.concat([pending, chunk])
    let end = pending.indexOf(NUL)
    while (end !== -1) {
      yield pending.subarray(0, end).toString('utf8')
      pending = pending.subarray(end + 1)
      end = pending.indexOf(NUL)
    }
  }
}

export type BatchObject =
  | {
      readonly kind: 'object'
      readonly id: string
      readonly type: string
      readonly bytes: Uint8Array
    }
  | {
      readonly kind: 'too-large'
      readonly id: string
      readonly type: string
      readonly size: number
    }
  | { readonly kind: 'missing'; readonly id: string }

interface Body {
  readonly id: string
  readonly type: string
  readonly size: number
  /** Null once the object is known to be over the cap: its bytes are counted, not kept. */
  readonly parts: Buffer[] | null
  remaining: number
}

/**
 * The objects `git cat-file --batch` writes: a header line `<id> <type>
 * <size>` and the contents followed by a line feed, or `<id> missing`.
 * Contents over `maxBytes` are skipped as they arrive, never collected.
 */
export async function* batchObjects(
  chunks: AsyncIterable<Buffer>,
  maxBytes: number,
): AsyncGenerator<BatchObject> {
  let pending = Buffer.alloc(0)
  let body: Body | null = null
  for await (const chunk of chunks) {
    pending = Buffer.concat([pending, chunk])
    for (;;) {
      if (body === null) {
        const end = pending.indexOf(LINE_FEED)
        if (end === -1) break
        const [id = '', type = '', size = ''] = pending.subarray(0, end).toString('utf8').split(' ')
        pending = pending.subarray(end + 1)
        if (size === '') {
          yield { kind: 'missing', id }
          continue
        }
        const length = Number(size)
        body = {
          id,
          type,
          size: length,
          parts: length <= maxBytes ? [] : null,
          remaining: length + 1,
        }
        continue
      }
      const taken = Math.min(body.remaining, pending.length)
      body.parts?.push(pending.subarray(0, taken))
      body.remaining -= taken
      pending = pending.subarray(taken)
      if (body.remaining > 0) break
      const { id, type, size, parts } = body
      body = null
      yield parts === null
        ? { kind: 'too-large', id, type, size }
        : { kind: 'object', id, type, bytes: Buffer.concat(parts).subarray(0, size) }
    }
  }
}
