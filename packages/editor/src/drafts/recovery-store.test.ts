import { describe, expect, it } from 'vitest'
import type { DocumentAst } from './clients.ts'
import type { PendingDraft } from './recovery-store.ts'
import { createMemoryRecoveryStore } from './recovery-store.ts'

const ast: DocumentAst = { type: 'root', children: [] }
const entry: PendingDraft = { ast, expectedVersion: 3, savedAt: 10 }

describe('createMemoryRecoveryStore', () => {
  it('is empty until something is buffered', () => {
    expect(createMemoryRecoveryStore().read()).toBeUndefined()
  })

  it('starts from an entry left over from a previous session', () => {
    expect(createMemoryRecoveryStore(entry).read()).toBe(entry)
  })

  it('keeps only the latest entry, because an edit supersedes the one before it', () => {
    const store = createMemoryRecoveryStore()
    const later: PendingDraft = { ast, expectedVersion: 4, savedAt: 20 }

    store.write(entry)
    store.write(later)
    expect(store.read()).toBe(later)
  })

  it('forgets the entry once it has been acknowledged', () => {
    const store = createMemoryRecoveryStore(entry)
    store.clear()
    expect(store.read()).toBeUndefined()
  })
})

describe('the base a recovery store keeps', () => {
  it('has none until one is written', () => {
    expect(createMemoryRecoveryStore().readBase()).toBeUndefined()
  })

  it('starts from a base left over from a previous session', () => {
    expect(createMemoryRecoveryStore(entry, { ast, draftVersion: 2 }).readBase()).toEqual({
      ast,
      draftVersion: 2,
    })
  })

  it('keeps only the latest base, and outlives the edit it was the base of', () => {
    const store = createMemoryRecoveryStore(entry)
    store.writeBase({ ast, draftVersion: 3 })
    store.writeBase({ ast, draftVersion: 4 })
    store.clear()
    expect(store.readBase()).toEqual({ ast, draftVersion: 4 })
  })
})
