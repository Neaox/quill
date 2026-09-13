import { describe, expect, it } from 'vitest'

import { DocumentIndex } from './document-index.ts'
import { GitRepository } from './git/git-repository.ts'
import { setPath } from './git/tree-path.ts'
import { MemoryObjectStore } from './memory-object-store.ts'
import type { ObjectEntry, ObjectStore } from './object-store.ts'
import { markdown, newDocument } from './test-fixtures.ts'

/** A store that says how often the index went back to it. */
class CountingStore implements ObjectStore {
  reads = 0
  readonly #inner = new MemoryObjectStore()

  async read(oid: string): Promise<Uint8Array | null> {
    this.reads += 1
    return await this.#inner.read(oid)
  }

  write(oid: string, bytes: Uint8Array): Promise<void> {
    return this.#inner.write(oid, bytes)
  }

  writeBatch(entries: readonly ObjectEntry[]): Promise<void> {
    return this.#inner.writeBatch(entries)
  }

  has(oid: string): Promise<boolean> {
    return this.#inner.has(oid)
  }

  readRef(name: string): Promise<string | null> {
    return this.#inner.readRef(name)
  }

  casRef(name: string, expected: string | null, next: string): Promise<boolean> {
    return this.#inner.casRef(name, expected, next)
  }
}

const ONBOARDING = newDocument()
const ARCHITECTURE = newDocument()

async function treeOf(
  repository: GitRepository,
  files: ReadonlyArray<readonly [string, string]>,
): Promise<string> {
  let tree: string | null = null
  for (const [path, content] of files) {
    tree = await setPath(repository, tree, path, repository.stageBlob(content))
  }
  await repository.flush()
  return tree ?? repository.stageTree([])
}

describe('DocumentIndex', () => {
  it('maps every document in a tree to its path and its blob', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    const tree = await treeOf(repository, [
      ['handbook/onboarding.md', markdown(ONBOARDING, 'Onboarding')],
      ['assets/diagram.svg', '<svg />'],
      ['untitled.md', '# No front matter\n'],
    ])
    const documents = await new DocumentIndex().of(repository, tree)
    expect(documents.byId.get(ONBOARDING)?.path).toBe('handbook/onboarding.md')
    expect(documents.idByPath.get('handbook/onboarding.md')).toBe(ONBOARDING)
    expect(documents.idByPath.has('untitled.md')).toBe(false)
    expect(documents.idByPath.has('assets/diagram.svg')).toBe(false)
  })

  it('lets the first file to claim an id keep it', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    const tree = await treeOf(repository, [
      ['a.md', markdown(ONBOARDING, 'Onboarding')],
      ['b.md', markdown(ONBOARDING, 'A copy someone made')],
    ])
    const documents = await new DocumentIndex().of(repository, tree)
    expect(documents.byId.get(ONBOARDING)?.path).toBe('a.md')
    expect(documents.idByPath.get('b.md')).toBe(ONBOARDING)
  })

  it('reads a tree once however often it is asked about', async () => {
    const store = new CountingStore()
    const repository = new GitRepository(store)
    const tree = await treeOf(repository, [['a.md', markdown(ONBOARDING, 'Onboarding')]])
    const index = new DocumentIndex()
    const first = await index.of(repository, tree)
    const reads = store.reads
    expect(await index.of(repository, tree)).toBe(first)
    expect(store.reads).toBe(reads)
  })

  it('keeps only as many trees as it was given room for', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    const one = await treeOf(repository, [['a.md', markdown(ONBOARDING, 'One')]])
    const two = await treeOf(repository, [['a.md', markdown(ARCHITECTURE, 'Two')]])
    const index = new DocumentIndex(1)
    const first = await index.of(repository, one)
    await index.of(repository, two)
    expect(index.size).toBe(1)
    expect(await index.of(repository, one)).not.toBe(first)
  })

  it('evicts the tree it has gone longest without', async () => {
    const repository = new GitRepository(new MemoryObjectStore())
    const one = await treeOf(repository, [['a.md', markdown(ONBOARDING, 'One')]])
    const two = await treeOf(repository, [['a.md', markdown(ARCHITECTURE, 'Two')]])
    const three = await treeOf(repository, [['c.md', markdown(ONBOARDING, 'Three')]])
    const index = new DocumentIndex(2)
    const first = await index.of(repository, one)
    await index.of(repository, two)
    // Touching the older entry again makes the newer one the eviction candidate.
    expect(await index.of(repository, one)).toBe(first)
    await index.of(repository, three)
    expect(await index.of(repository, one)).toBe(first)
    expect(index.size).toBe(2)
  })
})
