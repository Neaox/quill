import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { BlobRef, BlobStore } from '@quill/application'

/**
 * The self-host blob store: one file per object, named by its own SHA-256.
 *
 * The layout fans out on the first four hex characters — `ab/cd/abcd…` — for
 * the same reason Git does: a directory holding a million entries is slow to
 * list on every filesystem that exists, and two levels of 256 keep any one
 * directory small at any instance size a self-host reaches.
 *
 * A write goes to a temporary file in the same directory, is flushed, and is
 * renamed into place, so a crash mid-write leaves a stray temporary file and
 * never a truncated object under a hash that claims to be complete. This is
 * the same discipline `packages/content-store` applies to published objects,
 * and for the same reason: a reader that finds a hash must find all of it.
 *
 * The stray temporary file that a crash does leave behind is swept at startup
 * (`sweepTemporary`, called from the composition root): without it a server
 * that is killed under load accumulates half-written uploads in `tmp/` for
 * ever, which is a disk filling slowly and silently.
 */
export class FilesystemBlobStore implements BlobStore {
  readonly #root: string

  constructor(root: string) {
    this.#root = root
  }

  async put(chunks: AsyncIterable<Uint8Array>, contentType: string): Promise<BlobRef> {
    // A name nothing else will draw, for a file that exists only until the
    // rename below. It is not an identity, so it asks for no `IdGenerator`.
    const temporary = join(
      this.#root,
      'tmp',
      `${randomBytes(16).toString('hex')}${TEMPORARY_SUFFIX}`,
    )
    await mkdir(dirname(temporary), { recursive: true })

    const hash = createHash('sha256')
    let size = 0
    const handle = await open(temporary, 'wx')
    try {
      for await (const chunk of chunks) {
        hash.update(chunk)
        size += chunk.length
        await handle.write(chunk)
      }
      // Flushed before the rename: a rename is atomic for the *name*, not for
      // the bytes, so without this a crash could publish an empty object.
      await handle.sync()
    } catch (error) {
      await handle.close()
      await rm(temporary, { force: true })
      throw error
    }
    await handle.close()

    const digest = hash.digest('hex')
    const destination = this.#pathFor(digest)
    await mkdir(dirname(destination), { recursive: true })
    // The same bytes are the same object, so an object that is already there
    // is already correct: the temporary file is dropped rather than renamed
    // over it, which keeps a concurrent reader from meeting a moment where the
    // name points at a file being replaced.
    if (await exists(destination)) {
      await rm(temporary, { force: true })
    } else {
      await rename(temporary, destination)
    }

    return { hash: digest, size, contentType }
  }

  async open(hash: string): Promise<AsyncIterable<Uint8Array> | null> {
    const path = this.#pathFor(hash)
    if (!(await exists(path))) return null
    return createReadStream(path)
  }

  async has(hash: string): Promise<boolean> {
    return exists(this.#pathFor(hash))
  }

  async delete(hash: string): Promise<void> {
    await rm(this.#pathFor(hash), { force: true })
  }

  /**
   * Removes temporary files older than `olderThanMs`, answering how many went.
   *
   * By age rather than outright, because another process — a second server
   * against the same directory — may be part-way through a write of its own,
   * and an hour is far longer than any upload this platform accepts can take
   * (the cap is 25 MiB by default). A file younger than that is somebody's
   * work in progress; one older than that is a crash's leftovers.
   *
   * `now` is a parameter rather than a read of the clock, like every other
   * time this codebase compares against (ADR-021, `ports/system.ts`).
   */
  async sweepTemporary(olderThanMs: number, now: Date): Promise<number> {
    const directory = join(this.#root, 'tmp')
    let entries: readonly string[]
    try {
      entries = await readdir(directory)
    } catch {
      // No temporary directory means nothing has ever been written here.
      return 0
    }

    let swept = 0
    for (const entry of entries) {
      if (!entry.endsWith(TEMPORARY_SUFFIX)) continue
      const path = join(directory, entry)
      try {
        const info = await stat(path)
        if (now.getTime() - info.mtimeMs < olderThanMs) continue
        await rm(path, { force: true })
        swept += 1
      } catch {
        // Another process removed it between the listing and now, which is
        // the outcome this was after anyway.
      }
    }
    return swept
  }

  /**
   * Where a hash lives.
   *
   * A hash is 64 hex characters and nothing else, so a caller cannot steer
   * this at a path of their choosing — which matters because attachment ids
   * come from requests and the hashes behind them come from the database.
   */
  #pathFor(hash: string): string {
    if (!/^[0-9a-f]{64}$/u.test(hash)) {
      throw new Error(`A blob address is a lower-case hex SHA-256, received "${hash}"`)
    }
    return join(this.#root, hash.slice(0, 2), hash.slice(2, 4), hash)
  }
}

/** What an in-progress write is called until it is renamed into place. */
const TEMPORARY_SUFFIX = '.part'

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
