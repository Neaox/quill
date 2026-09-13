/**
 * Minimal Git object model: blob/tree/commit encoding, SHA-1 identity,
 * and a pluggable ObjectStore so the same code can sit on a filesystem,
 * Postgres, or S3.  No working tree, no index.
 *
 * Spike R4. Throw-away code.
 */

import { createHash } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'

export type GitObjectType = 'blob' | 'tree' | 'commit' | 'tag'

export interface RawObject {
  type: GitObjectType
  body: Buffer
}

/**
 * The whole pluggable surface. A Postgres or S3 backend implements exactly
 * these six methods; nothing else in this file touches storage.
 */
export interface ObjectStore {
  /** Read an object by its 40-char hex oid. null when absent. */
  read(oid: string): Promise<RawObject | null>
  /** Write an object. Content-addressed: a re-write of the same oid is a no-op. */
  write(oid: string, type: GitObjectType, body: Buffer): Promise<void>
  has(oid: string): Promise<boolean>
  /** Read a ref such as `refs/heads/main`. null when unborn. */
  readRef(name: string): Promise<string | null>
  /**
   * Compare-and-swap a ref. Returns true on success, false when the ref
   * no longer holds `expected` (someone else advanced it).
   */
  casRef(name: string, expected: string | null, next: string): Promise<boolean>
  /** Optional batch write; default implementations may just loop. */
  writeBatch?(objects: Array<{ oid: string; type: GitObjectType; body: Buffer }>): Promise<void>
}

// ---------------------------------------------------------------- hashing

export function hashObject(type: GitObjectType, body: Buffer): string {
  const header = Buffer.from(`${type} ${body.length}\0`, 'utf8')
  return createHash('sha1').update(header).update(body).digest('hex')
}

/** Wire form of a loose object: zlib-deflated `<type> <len>\0<body>`. */
export function encodeLoose(type: GitObjectType, body: Buffer, level = 1): Buffer {
  const header = Buffer.from(`${type} ${body.length}\0`, 'utf8')
  return deflateSync(Buffer.concat([header, body]), { level })
}

export function decodeLoose(raw: Buffer): RawObject {
  const inflated = inflateSync(raw)
  const nul = inflated.indexOf(0)
  const header = inflated.subarray(0, nul).toString('utf8')
  const space = header.indexOf(' ')
  const type = header.slice(0, space) as GitObjectType
  return { type, body: inflated.subarray(nul + 1) }
}

// ------------------------------------------------------------------ trees

export const MODE_FILE = '100644'
export const MODE_EXEC = '100755'
export const MODE_SYMLINK = '120000'
export const MODE_TREE = '40000'

export interface TreeEntry {
  mode: string
  name: string
  oid: string
}

/**
 * Git's tree ordering: byte-compare names, but a subtree sorts as if its
 * name had a trailing slash. Getting this wrong produces a tree that
 * `git fsck` rejects, so it is the single most delicate piece of encoding.
 */
function entrySortKey(e: TreeEntry): string {
  return e.mode === MODE_TREE ? `${e.name}/` : e.name
}

export function compareEntries(a: TreeEntry, b: TreeEntry): number {
  const ka = Buffer.from(entrySortKey(a), 'utf8')
  const kb = Buffer.from(entrySortKey(b), 'utf8')
  return Buffer.compare(ka, kb)
}

export function encodeTree(entries: TreeEntry[]): Buffer {
  const sorted = [...entries].sort(compareEntries)
  const parts: Buffer[] = []
  for (const e of sorted) {
    parts.push(Buffer.from(`${e.mode} ${e.name}\0`, 'utf8'))
    parts.push(Buffer.from(e.oid, 'hex'))
  }
  return Buffer.concat(parts)
}

export function decodeTree(body: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = []
  let i = 0
  while (i < body.length) {
    const space = body.indexOf(0x20, i)
    const mode = body.subarray(i, space).toString('utf8')
    const nul = body.indexOf(0, space)
    const name = body.subarray(space + 1, nul).toString('utf8')
    const oid = body.subarray(nul + 1, nul + 21).toString('hex')
    entries.push({ mode, name, oid })
    i = nul + 21
  }
  return entries
}

// ---------------------------------------------------------------- commits

export interface Identity {
  name: string
  email: string
  /** Unix seconds. */
  when: number
  /** e.g. `+0000`. */
  tz: string
}

export interface CommitObject {
  tree: string
  parents: string[]
  author: Identity
  committer: Identity
  message: string
}

function encodeIdentity(id: Identity): string {
  return `${id.name} <${id.email}> ${id.when} ${id.tz}`
}

function decodeIdentity(s: string): Identity {
  const lt = s.indexOf('<')
  const gt = s.indexOf('>', lt)
  const name = s.slice(0, lt).trim()
  const email = s.slice(lt + 1, gt)
  const rest = s
    .slice(gt + 2)
    .trim()
    .split(' ')
  return { name, email, when: Number(rest[0]), tz: rest[1] ?? '+0000' }
}

export function encodeCommit(c: CommitObject): Buffer {
  const lines: string[] = [`tree ${c.tree}`]
  for (const p of c.parents) lines.push(`parent ${p}`)
  lines.push(`author ${encodeIdentity(c.author)}`)
  lines.push(`committer ${encodeIdentity(c.committer)}`)
  lines.push('')
  lines.push(c.message.endsWith('\n') ? c.message : `${c.message}\n`)
  return Buffer.from(lines.join('\n'), 'utf8')
}

export function decodeCommit(body: Buffer): CommitObject {
  const text = body.toString('utf8')
  const blank = text.indexOf('\n\n')
  const head = text.slice(0, blank === -1 ? text.length : blank)
  const message = blank === -1 ? '' : text.slice(blank + 2)
  let tree = ''
  const parents: string[] = []
  let author: Identity = { name: '', email: '', when: 0, tz: '+0000' }
  let committer = author
  for (const line of head.split('\n')) {
    if (line.startsWith('tree ')) tree = line.slice(5)
    else if (line.startsWith('parent ')) parents.push(line.slice(7))
    else if (line.startsWith('author ')) author = decodeIdentity(line.slice(7))
    else if (line.startsWith('committer ')) committer = decodeIdentity(line.slice(10))
  }
  return { tree, parents, author, committer, message }
}

/** Read the trailer block at the end of a commit message. */
export function readTrailers(message: string): Record<string, string> {
  const lines = message.trimEnd().split('\n')
  const out: Record<string, string> = {}
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line === undefined) break
    if (line.trim() === '') break
    const m = /^([A-Za-z][A-Za-z0-9-]*): (.*)$/.exec(line)
    if (!m) break
    out[m[1] as string] = m[2] as string
  }
  return out
}

// --------------------------------------------------- high level helpers

export async function writeBlob(store: ObjectStore, content: Buffer): Promise<string> {
  const oid = hashObject('blob', content)
  await store.write(oid, 'blob', content)
  return oid
}

export async function writeTree(store: ObjectStore, entries: TreeEntry[]): Promise<string> {
  const body = encodeTree(entries)
  const oid = hashObject('tree', body)
  await store.write(oid, 'tree', body)
  return oid
}

export async function writeCommit(store: ObjectStore, c: CommitObject): Promise<string> {
  const body = encodeCommit(c)
  const oid = hashObject('commit', body)
  await store.write(oid, 'commit', body)
  return oid
}

export async function readTree(store: ObjectStore, oid: string): Promise<TreeEntry[]> {
  const o = await store.read(oid)
  if (!o) throw new Error(`missing tree ${oid}`)
  if (o.type !== 'tree') throw new Error(`${oid} is a ${o.type}, not a tree`)
  return decodeTree(o.body)
}

export async function readCommit(store: ObjectStore, oid: string): Promise<CommitObject> {
  const o = await store.read(oid)
  if (!o) throw new Error(`missing commit ${oid}`)
  return decodeCommit(o.body)
}

/**
 * Resolve a path inside a tree to its blob oid. null when the path is absent.
 * Cost: one object read per path component.
 */
export async function resolvePath(
  store: ObjectStore,
  rootTree: string,
  path: string,
): Promise<string | null> {
  const parts = path.split('/')
  let current = rootTree
  for (let i = 0; i < parts.length; i++) {
    const entries = await readTree(store, current)
    const name = parts[i]
    const hit = entries.find((e) => e.name === name)
    if (!hit) return null
    if (i === parts.length - 1) return hit.oid
    if (hit.mode !== MODE_TREE) return null
    current = hit.oid
  }
  return null
}

/**
 * Replace (or insert, or delete when blobOid is null) one path in a tree and
 * write every tree on the way back up. Cost: O(depth) reads + O(depth) writes,
 * independent of how many documents the repository holds.
 */
export async function setPath(
  store: ObjectStore,
  rootTree: string | null,
  path: string,
  blobOid: string | null,
  mode: string = MODE_FILE,
): Promise<string> {
  const parts = path.split('/')

  const recurse = async (treeOid: string | null, depth: number): Promise<string | null> => {
    const entries = treeOid ? await readTree(store, treeOid) : []
    const name = parts[depth] as string
    const idx = entries.findIndex((e) => e.name === name)
    if (depth === parts.length - 1) {
      if (blobOid === null) {
        if (idx === -1) return treeOid
        entries.splice(idx, 1)
      } else if (idx === -1) {
        entries.push({ mode, name, oid: blobOid })
      } else {
        entries[idx] = { mode, name, oid: blobOid }
      }
    } else {
      const childOid =
        idx === -1
          ? null
          : entries[idx]?.mode === MODE_TREE
            ? (entries[idx] as TreeEntry).oid
            : null
      const newChild = await recurse(childOid, depth + 1)
      if (newChild === null) {
        if (idx !== -1) entries.splice(idx, 1)
      } else if (idx === -1) {
        entries.push({ mode: MODE_TREE, name, oid: newChild })
      } else {
        entries[idx] = { mode: MODE_TREE, name, oid: newChild }
      }
    }
    if (entries.length === 0) return null // prune empty directories, as git does
    return await writeTree(store, entries)
  }

  const result = await recurse(rootTree, 0)
  return result ?? (await writeTree(store, []))
}

/** Build a whole tree from a flat path -> blob-oid map, in one pass. */
export async function buildTreeFromPaths(
  store: ObjectStore,
  files: Map<string, string>,
): Promise<string> {
  type Node = { dirs: Map<string, Node>; files: Map<string, string> }
  const root: Node = { dirs: new Map(), files: new Map() }
  for (const [path, oid] of files) {
    const parts = path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i] as string
      let next = node.dirs.get(seg)
      if (!next) {
        next = { dirs: new Map(), files: new Map() }
        node.dirs.set(seg, next)
      }
      node = next
    }
    node.files.set(parts[parts.length - 1] as string, oid)
  }
  const emit = async (node: Node): Promise<string> => {
    const entries: TreeEntry[] = []
    for (const [name, oid] of node.files) entries.push({ mode: MODE_FILE, name, oid })
    for (const [name, child] of node.dirs) {
      entries.push({ mode: MODE_TREE, name, oid: await emit(child) })
    }
    return await writeTree(store, entries)
  }
  return await emit(root)
}
