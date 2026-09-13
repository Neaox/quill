import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { readBlob } from '../ports/blob-store.ts'
import { createInMemoryBlobStore } from './in-memory-blob-store.ts'

async function* chunks(...parts: readonly string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield new TextEncoder().encode(part)
}

/** A stream that fails partway, which is what a dropped connection looks like. */
async function* broken(): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode('half')
  throw new Error('refused')
}

describe('createInMemoryBlobStore', () => {
  it('addresses what it stores by the hash of the bytes', async () => {
    const store = createInMemoryBlobStore()
    const ref = await store.put(chunks('hello ', 'world'), 'text/plain')

    expect(ref).toStrictEqual({
      hash: createHash('sha256').update('hello world').digest('hex'),
      size: 11,
      contentType: 'text/plain',
    })
    expect(await readBlob(store, ref.hash)).toStrictEqual(new TextEncoder().encode('hello world'))
  })

  it('stores the same bytes once however many times they are written', async () => {
    const store = createInMemoryBlobStore()
    const first = await store.put(chunks('same'), 'text/plain')
    const second = await store.put(chunks('sa', 'me'), 'text/plain')

    expect(second.hash).toBe(first.hash)
    expect(store.objects.size).toBe(1)
  })

  it('answers nothing for a hash it does not hold', async () => {
    const store = createInMemoryBlobStore()
    expect(await store.open('0'.repeat(64))).toBeNull()
    expect(await readBlob(store, '0'.repeat(64))).toBeNull()
    expect(await store.has('0'.repeat(64))).toBe(false)
  })

  it('removes an object, and removing nothing is not an error', async () => {
    const store = createInMemoryBlobStore()
    const ref = await store.put(chunks('gone'), 'text/plain')

    await store.delete(ref.hash)
    expect(await store.has(ref.hash)).toBe(false)
    await expect(store.delete(ref.hash)).resolves.toBeUndefined()
  })

  it('publishes nothing when the stream refuses partway through', async () => {
    const store = createInMemoryBlobStore()

    await expect(store.put(broken(), 'text/plain')).rejects.toThrow('refused')
    expect(store.objects.size).toBe(0)
  })

  it('empties itself when a test needs a blob to have gone missing', async () => {
    const store = createInMemoryBlobStore()
    await store.put(chunks('here'), 'text/plain')
    store.clear()
    expect(store.objects.size).toBe(0)
  })
})
