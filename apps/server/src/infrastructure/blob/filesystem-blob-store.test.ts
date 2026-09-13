import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readBlob } from '@quill/application'

import { FilesystemBlobStore } from './filesystem-blob-store.ts'

let root: string
let store: FilesystemBlobStore

async function* chunks(...parts: readonly string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield new TextEncoder().encode(part)
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Every file under `root`, as paths relative to it, so a test can see the layout. */
async function tree(directory: string, prefix = ''): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) found.push(...(await tree(join(directory, entry.name), path)))
    else found.push(path)
  }
  return found.toSorted()
}

/** A stream that fails partway, which is what a dropped connection looks like. */
async function* broken(): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode('half a file')
  throw new Error('the connection went away')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'quill-blob-test-'))
  store = new FilesystemBlobStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('FilesystemBlobStore', () => {
  it('names an object after the hash of its own bytes', async () => {
    const ref = await store.put(chunks('hello ', 'world'), 'text/plain')

    expect(ref).toStrictEqual({ hash: sha256('hello world'), size: 11, contentType: 'text/plain' })
    expect(await readBlob(store, ref.hash)).toStrictEqual(new TextEncoder().encode('hello world'))
  })

  it('fans the layout out on the first four characters of the hash', async () => {
    const ref = await store.put(chunks('fanned out'), 'text/plain')
    const expected = `${ref.hash.slice(0, 2)}/${ref.hash.slice(2, 4)}/${ref.hash}`

    expect(await tree(root)).toStrictEqual([expected])
    expect(await readFile(join(root, expected), 'utf8')).toBe('fanned out')
  })

  it('leaves no temporary file behind once a write has landed', async () => {
    await store.put(chunks('one'), 'text/plain')
    await store.put(chunks('two'), 'text/plain')

    const files = await tree(root)
    expect(files).toHaveLength(2)
    expect(files.some((path) => path.startsWith('tmp/'))).toBe(false)
  })

  it('stores the same bytes once however many times they are written', async () => {
    const first = await store.put(chunks('identical'), 'text/plain')
    const second = await store.put(chunks('ident', 'ical'), 'image/png')

    expect(second.hash).toBe(first.hash)
    // The second `put` declared a different type; the object is the bytes, and
    // the type belongs to the row that points at them.
    expect(second.contentType).toBe('image/png')
    expect(await tree(root)).toHaveLength(1)
  })

  it('streams a large object rather than holding it', async () => {
    const part = 'x'.repeat(64 * 1024)
    const ref = await store.put(chunks(part, part, part), 'application/pdf')

    expect(ref.size).toBe(part.length * 3)
    expect(await readBlob(store, ref.hash)).toHaveLength(part.length * 3)
  })

  it('answers nothing for a hash it does not hold', async () => {
    const absent = sha256('never written')
    expect(await store.open(absent)).toBeNull()
    expect(await store.has(absent)).toBe(false)
    expect(await readBlob(store, absent)).toBeNull()
  })

  it('removes an object, and removing one that is not there is not an error', async () => {
    const ref = await store.put(chunks('transient'), 'text/plain')

    await store.delete(ref.hash)
    expect(await store.has(ref.hash)).toBe(false)
    await expect(store.delete(ref.hash)).resolves.toBeUndefined()
  })

  it('publishes nothing, and keeps no temporary file, when the stream fails', async () => {
    await expect(store.put(broken(), 'text/plain')).rejects.toThrow('the connection went away')
    expect(await tree(root)).toStrictEqual([])
  })

  it('refuses an address that is not a SHA-256, whichever way it is asked', async () => {
    const traversal = '../../../etc/passwd'
    await expect(store.open(traversal)).rejects.toThrow('lower-case hex SHA-256')
    await expect(store.has(traversal)).rejects.toThrow('lower-case hex SHA-256')
    await expect(store.delete(traversal)).rejects.toThrow('lower-case hex SHA-256')
    // Upper case is not the address either: one set of bytes, one spelling.
    await expect(store.has(sha256('x').toUpperCase())).rejects.toThrow('lower-case hex SHA-256')
  })

  it('sweeps the temporary files a crash left behind, and spares the ones in progress', async () => {
    const temporary = join(root, 'tmp')
    await mkdir(temporary, { recursive: true })

    const now = new Date('2026-09-13T12:00:00.000Z')
    const abandoned = join(temporary, 'aaaa.part')
    const inProgress = join(temporary, 'bbbb.part')
    const notOurs = join(temporary, 'notes.txt')
    for (const path of [abandoned, inProgress, notOurs]) await writeFile(path, 'half', 'utf8')

    // Two hours old, and five minutes old.
    const old = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    await utimes(abandoned, old, old)
    await utimes(notOurs, old, old)
    const recent = new Date(now.getTime() - 5 * 60 * 1000)
    await utimes(inProgress, recent, recent)

    expect(await store.sweepTemporary(60 * 60 * 1000, now)).toBe(1)
    expect(await tree(root)).toStrictEqual(['tmp/bbbb.part', 'tmp/notes.txt'])
  })

  it('sweeps nothing, quietly, when nothing has ever been written here', async () => {
    expect(await store.sweepTemporary(60 * 60 * 1000, new Date())).toBe(0)
  })

  it('is not troubled by a temporary file that goes while it is looking at it', async () => {
    const temporary = join(root, 'tmp')
    await mkdir(temporary, { recursive: true })
    await writeFile(join(temporary, 'cccc.part'), 'half', 'utf8')
    // Another process got there first, which is the outcome the sweep wanted.
    await rm(join(temporary, 'cccc.part'))

    expect(await store.sweepTemporary(0, new Date())).toBe(0)
  })

  it('reads an object written by an earlier process', async () => {
    // What a restore from a backup looks like: the files are there, this
    // process wrote none of them.
    const hash = sha256('restored')
    const directory = join(root, hash.slice(0, 2), hash.slice(2, 4))
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, hash), 'restored', 'utf8')

    expect(await store.has(hash)).toBe(true)
    expect(await readBlob(store, hash)).toStrictEqual(new TextEncoder().encode('restored'))
  })
})
