import { describe, expect, it } from 'vitest'

import { MemoryObjectStore, MemoryObjectStoreProvider } from './memory-object-store.ts'
import { newWorkspaceId } from './test-fixtures.ts'

const REF = 'refs/heads/main'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

describe('MemoryObjectStore', () => {
  it('reads back what it wrote', async () => {
    const store = new MemoryObjectStore()
    await store.write(A, Uint8Array.of(1, 2, 3))
    expect(await store.read(A)).toEqual(Uint8Array.of(1, 2, 3))
    expect(await store.has(A)).toBe(true)
  })

  it('returns null and false for an object it does not hold', async () => {
    const store = new MemoryObjectStore()
    expect(await store.read(A)).toBeNull()
    expect(await store.has(A)).toBe(false)
  })

  it('treats a rewrite of the same object id as a no-op', async () => {
    const store = new MemoryObjectStore()
    await store.write(A, Uint8Array.of(1))
    await store.write(A, Uint8Array.of(9))
    expect(await store.read(A)).toEqual(Uint8Array.of(1))
    expect(store.size).toBe(1)
  })

  it('writes a batch', async () => {
    const store = new MemoryObjectStore()
    await store.writeBatch([
      { oid: A, bytes: Uint8Array.of(1) },
      { oid: B, bytes: Uint8Array.of(2) },
    ])
    expect(store.size).toBe(2)
  })

  it('creates an unborn ref only when the caller expects null', async () => {
    const store = new MemoryObjectStore()
    expect(await store.readRef(REF)).toBeNull()
    expect(await store.casRef(REF, A, B)).toBe(false)
    expect(await store.casRef(REF, null, A)).toBe(true)
    expect(await store.readRef(REF)).toBe(A)
  })

  it('refuses to advance a ref that has moved', async () => {
    const store = new MemoryObjectStore()
    await store.casRef(REF, null, A)
    expect(await store.casRef(REF, null, B)).toBe(false)
    expect(await store.casRef(REF, A, B)).toBe(true)
    expect(await store.readRef(REF)).toBe(B)
  })
})

describe('MemoryObjectStoreProvider', () => {
  it('gives each workspace its own store and remembers it', async () => {
    const provider = new MemoryObjectStoreProvider()
    const one = newWorkspaceId()
    const two = newWorkspaceId()
    expect(await provider.forWorkspace(one)).toBe(await provider.forWorkspace(one))
    expect(await provider.forWorkspace(one)).not.toBe(await provider.forWorkspace(two))
  })
})
