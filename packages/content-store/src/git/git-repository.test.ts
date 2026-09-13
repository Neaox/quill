import { describe, expect, it } from 'vitest'

import { MemoryObjectStore } from '../memory-object-store.ts'
import type { ObjectStore } from '../object-store.ts'
import { UTC } from './commit.ts'
import { GitRepository } from './git-repository.ts'
import { GitObjectError, hashObject } from './objects.ts'
import { MODE_FILE } from './tree.ts'

const identity = { name: 'Ada', email: 'ada@example.com', when: 1, timezone: UTC }

describe('GitRepository staging', () => {
  it('writes nothing until it is flushed', async () => {
    const store = new MemoryObjectStore()
    const repository = new GitRepository(store)
    const oid = repository.stageBlob('hello\n')
    expect(await store.read(oid)).toBeNull()
    await repository.flush()
    expect(await store.read(oid)).not.toBeNull()
  })

  it('reads an object it has only staged', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    const oid = repository.stageBlob('hello\n')
    expect(await repository.readBlobText(oid)).toBe('hello\n')
  })

  it('stages an object once however often it is offered', async () => {
    const store = new MemoryObjectStore()
    const repository = new GitRepository(store)
    repository.stageBlob('same')
    repository.stageBlob('same')
    await repository.flush()
    expect(store.size).toBe(1)
  })

  it('does not write again once flushed', async () => {
    const store = new MemoryObjectStore()
    const repository = new GitRepository(store)
    repository.stageBlob('hello\n')
    await repository.flush()
    await repository.flush()
    expect(store.size).toBe(1)
  })

  it('gives a staged blob the object id git would give it', () => {
    const repository = new GitRepository(new MemoryObjectStore())
    expect(repository.stageBlob('hello\n')).toBe(hashObject('blob', Buffer.from('hello\n')))
  })
})

describe('GitRepository reading', () => {
  it('reads a tree and a commit it staged', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    const blob = repository.stageBlob('hello\n')
    const tree = repository.stageTree([{ mode: MODE_FILE, name: 'a.md', oid: blob }])
    const commit = repository.stageCommit({
      tree,
      parents: [],
      author: identity,
      committer: identity,
      message: 'Subject\n',
    })
    expect(await repository.readTree(tree)).toEqual([{ mode: MODE_FILE, name: 'a.md', oid: blob }])
    expect((await repository.readCommit(commit)).tree).toBe(tree)
  })

  it('returns null for an object that is nowhere', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    expect(await repository.readObject('a'.repeat(40))).toBeNull()
  })

  it('names the object when one is missing', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    await expect(repository.readTree('a'.repeat(40))).rejects.toThrow(/is missing/)
  })

  it('refuses to read an object as the wrong type', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    const blob = repository.stageBlob('hello\n')
    await expect(repository.readCommit(blob)).rejects.toThrow(GitObjectError)
  })
})

describe('GitRepository.findCommit', () => {
  it('finds a commit that is there', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    const tree = repository.stageTree([])
    const oid = repository.stageCommit({
      tree,
      parents: [],
      author: identity,
      committer: identity,
      message: 'Subject\n',
    })
    expect((await repository.findCommit(oid))?.tree).toBe(tree)
  })

  it('has nothing to find for a revision the store does not hold', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    expect(await repository.findCommit('a'.repeat(40))).toBeNull()
  })

  it('has nothing to find when the object is not a commit', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    expect(await repository.findCommit(repository.stageBlob('hello\n'))).toBeNull()
  })
})

describe('GitRepository.flush', () => {
  it('keeps objects staged when the write fails, so a retry can write them', async () => {
    const store = new MemoryObjectStore()
    let attempts = 0
    const failing: ObjectStore = {
      read: (oid) => store.read(oid),
      write: (oid, bytes) => store.write(oid, bytes),
      has: (oid) => store.has(oid),
      readRef: (name) => store.readRef(name),
      casRef: (name, expected, next) => store.casRef(name, expected, next),
      writeBatch: async (entries) => {
        attempts += 1
        if (attempts === 1) throw new Error('disk full')
        await store.writeBatch(entries)
      },
    }
    const repository = new GitRepository(failing)
    const oid = repository.stageBlob('hello\n')
    await expect(repository.flush()).rejects.toThrow('disk full')
    await repository.flush()
    expect(await store.read(oid)).not.toBeNull()
  })
})
