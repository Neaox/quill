/**
 * Git object identity and serialisation.
 *
 * An object's wire form is `<type> <byte length>\0<body>` and its object id is
 * the SHA-1 of exactly those bytes. That form is what the {@link ObjectStore}
 * port stores, so a backend never has to know what a tree or a commit is: it
 * stores opaque bytes under a hash it can verify itself.
 */

import { createHash } from 'node:crypto'

export type GitObjectType = 'blob' | 'tree' | 'commit' | 'tag'

export interface GitObject {
  readonly type: GitObjectType
  readonly body: Buffer
}

const OBJECT_TYPES: ReadonlySet<string> = new Set(['blob', 'tree', 'commit', 'tag'])

/** Raised when stored bytes are not a well-formed Git object. */
export class GitObjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitObjectError'
  }
}

export function isGitObjectType(value: string): value is GitObjectType {
  return OBJECT_TYPES.has(value)
}

/** The bytes an object is stored and hashed as. */
export function serialiseObject(type: GitObjectType, body: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(`${type} ${body.length}\0`, 'utf8'), body])
}

export function parseObject(bytes: Uint8Array): GitObject {
  const buffer = toBuffer(bytes)
  const terminator = buffer.indexOf(0)
  if (terminator === -1) throw new GitObjectError('Object header has no NUL terminator')
  const header = buffer.subarray(0, terminator).toString('utf8')
  const space = header.indexOf(' ')
  const type = header.slice(0, space)
  if (!isGitObjectType(type)) throw new GitObjectError(`Unknown object type "${header}"`)
  const body = buffer.subarray(terminator + 1)
  const declared = Number(header.slice(space + 1))
  if (declared !== body.length) {
    throw new GitObjectError(
      `Object length ${declared} does not match ${body.length} bytes of body`,
    )
  }
  return { type, body }
}

/** The 40-character hex object id git would give these contents. */
export function hashObject(type: GitObjectType, body: Uint8Array): string {
  return hashSerialised(serialiseObject(type, body))
}

/**
 * The object id of bytes that are already in their stored form. A store can
 * verify what it read without knowing what a tree or a commit is.
 */
export function hashSerialised(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex')
}

/** The shape of an object id: 40 lowercase hex characters and nothing else. */
export const OID_PATTERN = /^[0-9a-f]{40}$/

export function isObjectId(value: string): boolean {
  return OID_PATTERN.test(value)
}

/**
 * Adopt bytes from an arbitrary {@link ObjectStore} without copying them.
 * A store is free to return a plain `Uint8Array`; the decoders want `Buffer`.
 */
export function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)
}
