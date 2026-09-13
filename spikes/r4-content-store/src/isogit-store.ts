/**
 * The same publish path built on isomorphic-git, for comparison.
 *
 * Notes recorded while writing it:
 *  - Everything needed exists without a working tree: writeBlob, readTree,
 *    writeTree, writeCommit, resolveRef, writeRef, readCommit, log.
 *  - There is NO compare-and-swap on refs. `writeRef` is an unconditional
 *    overwrite, so the lockfile protocol has to be written by hand anyway
 *    (see casRef below, which reuses our FsObjectStore implementation).
 *  - The pluggability story is an injected `fs` object, not an object store:
 *    a Postgres/S3 backend has to impersonate a POSIX filesystem including
 *    readdir, stat and lstat semantics, not just get/put by SHA.
 */

import * as nodeFs from 'node:fs'
import git from 'isomorphic-git'
import { FsObjectStore } from './fs-store.ts'
import type { ContentChange, PublishResult, RevisionSummary } from './content-store.ts'
import { buildMessage } from './content-store.ts'

const fs = nodeFs

interface IsoTreeEntry {
  mode: string
  path: string
  oid: string
  type: 'blob' | 'tree' | 'commit'
}

export class IsoContentStore {
  private gitdir: string
  private ref: string
  private cas: FsObjectStore

  constructor(gitdir: string, ref = 'refs/heads/main') {
    this.gitdir = gitdir
    this.ref = ref
    this.cas = new FsObjectStore(gitdir)
  }

  static async init(gitdir: string): Promise<IsoContentStore> {
    await git.init({ fs, gitdir, bare: true, defaultBranch: 'main' })
    return new IsoContentStore(gitdir)
  }

  async head(): Promise<string | null> {
    try {
      return await git.resolveRef({ fs, gitdir: this.gitdir, ref: this.ref })
    } catch {
      return null
    }
  }

  private async setPath(rootTree: string | null, path: string, blobOid: string | null) {
    const parts = path.split('/')
    const recurse = async (treeOid: string | null, depth: number): Promise<string | null> => {
      let entries: IsoTreeEntry[] = []
      if (treeOid) {
        const t = await git.readTree({ fs, gitdir: this.gitdir, oid: treeOid })
        entries = t.tree as IsoTreeEntry[]
      }
      const name = parts[depth] as string
      const idx = entries.findIndex((e) => e.path === name)
      if (depth === parts.length - 1) {
        if (blobOid === null) {
          if (idx === -1) return treeOid
          entries.splice(idx, 1)
        } else {
          const entry: IsoTreeEntry = { mode: '100644', path: name, oid: blobOid, type: 'blob' }
          if (idx === -1) entries.push(entry)
          else entries[idx] = entry
        }
      } else {
        const child = idx === -1 ? null : (entries[idx] as IsoTreeEntry).oid
        const next = await recurse(child, depth + 1)
        if (next === null) {
          if (idx !== -1) entries.splice(idx, 1)
        } else {
          const entry: IsoTreeEntry = { mode: '040000', path: name, oid: next, type: 'tree' }
          if (idx === -1) entries.push(entry)
          else entries[idx] = entry
        }
      }
      if (entries.length === 0) return null
      return await git.writeTree({ fs, gitdir: this.gitdir, tree: entries })
    }
    const result = await recurse(rootTree, 0)
    return result ?? (await git.writeTree({ fs, gitdir: this.gitdir, tree: [] }))
  }

  async publish(change: ContentChange, _base: string | null): Promise<PublishResult> {
    const blobOid =
      change.content === null
        ? null
        : await git.writeBlob({
            fs,
            gitdir: this.gitdir,
            blob: new Uint8Array(Buffer.from(change.content, 'utf8')),
          })

    for (let attempt = 1; attempt <= 20; attempt++) {
      const head = await this.head()
      const parentTree = head
        ? (await git.readCommit({ fs, gitdir: this.gitdir, oid: head })).commit.tree
        : null
      const newTree = await this.setPath(parentTree, change.path, blobOid)
      const when = Math.floor(Date.now() / 1000)
      const oid = await git.writeCommit({
        fs,
        gitdir: this.gitdir,
        commit: {
          tree: newTree,
          parent: head ? [head] : [],
          author: {
            name: change.author.name,
            email: change.author.email,
            timestamp: when,
            timezoneOffset: 0,
          },
          committer: {
            name: 'Quill',
            email: 'quill@quill.invalid',
            timestamp: when,
            timezoneOffset: 0,
          },
          message: buildMessage(change),
        },
      })
      // isomorphic-git has no CAS; reuse our lockfile implementation.
      const ok = await this.cas.casRef(this.ref, head, oid)
      if (ok) return { revision: oid, blob: blobOid ?? '', attempts: attempt }
      await new Promise((r) => setTimeout(r, 1 + Math.floor(Math.random() * 2 ** attempt)))
    }
    throw new Error('publish: CAS exhausted')
  }

  async read(path: string, revision?: string): Promise<string | null> {
    const rev = revision ?? (await this.head())
    if (!rev) return null
    try {
      const { blob } = await git.readBlob({ fs, gitdir: this.gitdir, oid: rev, filepath: path })
      return Buffer.from(blob).toString('utf8')
    } catch {
      return null
    }
  }

  /** isomorphic-git's own path history. */
  async history(path: string, limit = 50): Promise<RevisionSummary[]> {
    const commits = await git.log({
      fs,
      gitdir: this.gitdir,
      ref: this.ref,
      filepath: path,
      depth: limit,
      force: true,
      follow: false,
    })
    return commits.map((c) => ({
      revision: c.oid,
      parent: c.commit.parent[0] ?? null,
      author: { name: c.commit.author.name, email: c.commit.author.email },
      when: c.commit.author.timestamp,
      subject: c.commit.message.split('\n')[0] ?? '',
      documentId: null,
      changeNote: null,
      blob: null,
    }))
  }
}
