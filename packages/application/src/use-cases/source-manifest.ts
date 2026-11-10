import { LineCounter, isMap, isNode, isScalar, isSeq, parseDocument } from 'yaml'
import type { Node, Pair, YAMLMap } from 'yaml'

import { BRAND } from '@quill/brand'
import {
  SOURCE_COLLECTION_ORDERS,
  checkSourcePath,
  checkSourcePattern,
  isSourceGlob,
  slugify,
  sourcePatternPrefix,
} from '@quill/domain'
import type { SourceCollectionOrder } from '@quill/domain'

import { isDocumentPath, titleFromPath } from './source-files.ts'

/**
 * The workspace manifest a source carries (ADR-061, "A source is configured
 * on a workspace"): the file in the repository that decides a sourced
 * workspace's structure.
 *
 * ```yaml
 * version: 1
 * workspaces:
 *   - slug: handbook
 *     collections:
 *       - { slug: guides, path: docs/guides, title: Guides }
 *       - { slug: decisions, path: docs/adr, title: Decisions, order: filename }
 *     exclude: [docs/guides/drafts/**]
 *     redirects: { docs/guides/old-setup.md: docs/guides/setup.md }
 * ```
 *
 * A manifest with top-level `collections` describes one workspace. Reading it
 * is pure: text in, a manifest or the first problem out, with the line the
 * problem is on so an administrator can find it. Keys this version does not
 * know are kept as a list (with their lines) rather than refused, so a later
 * version can give them meaning and a team can keep its own keys in the file.
 */

/** Where the manifest is read from when a source names no other path. */
export const SOURCE_MANIFEST_PATH = `.${BRAND.slug}/workspace.yaml`

export const SOURCE_MANIFEST_VERSION = 1

/** More than a manifest needs, and a bound on what one file can make a sync do. */
export const MAX_MANIFEST_COLLECTIONS = 200
export const MAX_MANIFEST_LIST = 1000
export const MAX_MANIFEST_TITLE_LENGTH = 200

export interface ManifestCollection {
  /** Its identity: a new title renames it, a new slug is another collection. */
  readonly slug: string
  readonly title: string
  /** A directory, a file, or a glob (`checkSourcePattern`). */
  readonly path: string
  readonly order: SourceCollectionOrder
}

export interface ManifestEntry {
  /** The workspace this entry describes; null for a manifest of top-level `collections`. */
  readonly slug: string | null
  readonly collections: readonly ManifestCollection[]
  /** Paths and globs read as if they were not in the source. */
  readonly exclude: readonly string[]
  /** Paths and globs of repository assets. Read and checked; imported by a later slice. */
  readonly assets: readonly string[]
  /** Old path to new path, in the order written: what rename detection missed. */
  readonly redirects: readonly (readonly [from: string, to: string])[]
}

/** A key this version does not read, where it is. */
export interface UnknownManifestKey {
  readonly key: string
  readonly line: number | null
}

/** Something the manifest left out that was read with a default, where it is. */
export interface ManifestNote {
  readonly line: number | null
  readonly message: string
}

export interface SourceManifest {
  readonly entries: readonly ManifestEntry[]
  readonly unknownKeys: readonly UnknownManifestKey[]
  /** The defaults the chosen entry was read with, such as a collection's title. */
  readonly notes: readonly ManifestNote[]
}

export interface ManifestReadOptions {
  /**
   * The entry a workspace reads, by its slug (`selectManifestEntry`). Only
   * that entry, or the only one, is held to every rule: another workspace's
   * entry is read for its slug and its unknown keys, and anything else wrong
   * with it is not this workspace's problem. Without one, a manifest of
   * several workspaces is read leniently throughout, so the problem said is
   * that none was chosen.
   */
  readonly entry?: string | null | undefined
}

/** Why a manifest cannot be read, and on which line; null when the problem is the whole file. */
export interface ManifestProblem {
  readonly line: number | null
  readonly message: string
}

export type ManifestReading =
  | { readonly ok: true; readonly manifest: SourceManifest }
  | { readonly ok: false; readonly problem: ManifestProblem }

/** A manifest problem as one sentence, naming the file and the line. */
export function describeManifestProblem(path: string, problem: ManifestProblem): string {
  return problem.line === null
    ? `${path}: ${problem.message}`
    : `${path}, line ${problem.line}: ${problem.message}`
}

class Refused extends Error {
  readonly line: number | null

  constructor(line: number | null, message: string) {
    super(message)
    this.name = 'ManifestRefused'
    this.line = line
  }
}

const ENTRY_KEYS = new Set(['collections', 'exclude', 'assets', 'redirects'])
const COLLECTION_KEYS = new Set(['slug', 'title', 'path', 'order'])

export function parseSourceManifest(
  text: string,
  options: ManifestReadOptions = {},
): ManifestReading {
  const lines = new LineCounter()
  const document = parseDocument(text, { lineCounter: lines })
  const syntax = document.errors[0]
  if (syntax !== undefined) {
    return {
      ok: false,
      problem: {
        /* v8 ignore next -- a parser given a line counter places every error it reports. */
        line: syntax.linePos?.[0].line ?? null,
        message: `it is not valid YAML (${syntax.code.toLowerCase().replaceAll('_', ' ')}).`,
      },
    }
  }
  try {
    return {
      ok: true,
      manifest: new ManifestReader(lines, options.entry ?? null).read(document.contents),
    }
  } catch (error) {
    /* v8 ignore next -- only a refusal is thrown while reading. */
    if (!(error instanceof Refused)) throw error
    return { ok: false, problem: { line: error.line, message: error.message } }
  }
}

/**
 * The entry a workspace reads. A manifest of one workspace answers that one;
 * a manifest of several answers the entry whose slug is the workspace's.
 */
export function selectManifestEntry(
  manifest: SourceManifest,
  workspaceSlug: string,
):
  | { readonly ok: true; readonly entry: ManifestEntry }
  | { readonly ok: false; readonly problem: ManifestProblem } {
  const [only, ...others] = manifest.entries
  if (only !== undefined && others.length === 0) return { ok: true, entry: only }
  const entry = manifest.entries.find((candidate) => candidate.slug === workspaceSlug)
  if (entry !== undefined) return { ok: true, entry }
  return {
    ok: false,
    problem: {
      line: null,
      message: `it describes ${manifest.entries.length} workspaces and none has the slug "${workspaceSlug}".`,
    },
  }
}

class ManifestReader {
  readonly #lines: LineCounter
  readonly #chosen: string | null
  readonly #unknown: UnknownManifestKey[] = []
  readonly #notes: ManifestNote[] = []

  constructor(lines: LineCounter, chosen: string | null) {
    this.#lines = lines
    this.#chosen = chosen
  }

  read(contents: Node | null): SourceManifest {
    const root = this.#map(contents, 'The manifest', 1)
    const version = this.#value(root, 'version')
    if (version === undefined)
      throw new Refused(1, `it needs "version: ${SOURCE_MANIFEST_VERSION}".`)
    if (!isScalar(version) || version.value !== SOURCE_MANIFEST_VERSION) {
      throw new Refused(
        this.#line(version),
        `this release reads manifest version ${SOURCE_MANIFEST_VERSION} only.`,
      )
    }
    const workspaces = this.#value(root, 'workspaces')
    const single = root.items.some((pair) => ENTRY_KEYS.has(this.#key(pair)))
    if (workspaces !== undefined && single) {
      throw new Refused(
        this.#line(workspaces),
        'a manifest has either "workspaces" or top-level "collections", not both.',
      )
    }
    this.#noteUnknown(root, '', new Set(['version', 'workspaces', ...ENTRY_KEYS]))
    if (workspaces === undefined) return this.#finish([this.#entry(root, null, '', true)])

    if (!isSeq(workspaces) || workspaces.items.length === 0) {
      throw new Refused(
        this.#line(workspaces),
        '"workspaces" must be a list of at least one workspace.',
      )
    }
    const only = workspaces.items.length === 1
    const entries: ManifestEntry[] = []
    const slugs = new Set<string>()
    for (const [index, item] of workspaces.items.entries()) {
      const entry = this.#workspace(item, `workspaces[${index}]`, only, this.#line(workspaces))
      if (entry === null) continue
      /* v8 ignore next -- an entry of "workspaces" always has its slug. */
      const slug = entry.slug ?? ''
      if (slugs.has(slug)) {
        // Two entries with the chosen slug leave nothing to choose between;
        // another workspace's duplicate is that workspace's to sort out.
        if (only || slug === this.#chosen)
          throw new Refused(this.#line(item), `two workspaces have the slug "${slug}".`)
        continue
      }
      slugs.add(slug)
      entries.push(entry)
    }
    return this.#finish(entries)
  }

  /**
   * One entry of `workspaces`. The entry this workspace reads, or the only
   * one, is held to every rule. Any other is read for its slug and its
   * unknown keys: whatever else is wrong with it is refused when a workspace
   * reads it, and here it is an entry with no collections. One whose slug
   * cannot be read is left out, since no workspace can choose it.
   */
  #workspace(
    item: unknown,
    where: string,
    only: boolean,
    listLine: number | null,
  ): ManifestEntry | null {
    const map = this.#map(item, `Each of "workspaces"`, listLine)
    let slug: string
    try {
      slug = this.#slug(map, where)
    } catch (error) {
      if (only) throw error
      return null
    }
    this.#noteUnknown(map, `${where}.`, new Set(['slug', ...ENTRY_KEYS]))
    if (only || slug === this.#chosen) return this.#entry(map, slug, `${where}.`, true)
    try {
      return this.#entry(map, slug, `${where}.`, false)
    } catch {
      return { slug, collections: [], exclude: [], assets: [], redirects: [] }
    }
  }

  #finish(entries: readonly ManifestEntry[]): SourceManifest {
    return { entries, unknownKeys: this.#unknown, notes: this.#notes }
  }

  #entry(map: YAMLMap, slug: string | null, prefix: string, chosen: boolean): ManifestEntry {
    const collections = this.#value(map, 'collections')
    if (!isSeq(collections) || collections.items.length === 0) {
      throw new Refused(
        collections === undefined ? this.#line(map) : this.#line(collections),
        `"${prefix}collections" must be a list of at least one collection.`,
      )
    }
    if (collections.items.length > MAX_MANIFEST_COLLECTIONS) {
      throw new Refused(
        this.#line(collections),
        `a workspace can have at most ${MAX_MANIFEST_COLLECTIONS} collections.`,
      )
    }
    const read: ManifestCollection[] = []
    for (const [index, item] of collections.items.entries()) {
      const where = `${prefix}collections[${index}]`
      const collection = this.#collection(item, where, chosen)
      const line = this.#line(item)
      if (read.some((other) => other.slug === collection.slug)) {
        throw new Refused(line, `two collections have the slug "${collection.slug}".`)
      }
      if (read.some((other) => other.path === collection.path)) {
        throw new Refused(line, `two collections read "${collection.path}".`)
      }
      read.push(collection)
    }
    return {
      slug,
      collections: read,
      exclude: this.#patterns(map, 'exclude', prefix),
      assets: this.#patterns(map, 'assets', prefix),
      redirects: this.#redirects(map, prefix),
    }
  }

  #collection(node: unknown, where: string, chosen: boolean): ManifestCollection {
    const map = this.#map(node, `"${where}"`, this.#line(node))
    this.#noteUnknown(map, `${where}.`, COLLECTION_KEYS)
    const slug = this.#slug(map, where)
    const pathNode = this.#value(map, 'path')
    const path = checkSourcePattern(this.#string(map, 'path', where))
    if (!path.ok) throw new Refused(this.#line(pathNode), path.error)
    let title: string
    if (this.#value(map, 'title') === undefined && chosen) {
      // A collection with no title is called after its directory, or its
      // file, as a folder with no README is; the note says so.
      title = collectionTitleOf(path.value)
      this.#notes.push({
        line: this.#line(map),
        message: `"${where}" has no title, so it is called "${title}", after its path.`,
      })
    } else {
      title = this.#string(map, 'title', where)
    }
    if (title.trim().length === 0 || title.length > MAX_MANIFEST_TITLE_LENGTH) {
      throw new Refused(
        this.#line(map),
        `"${where}.title" must be 1 to ${MAX_MANIFEST_TITLE_LENGTH} characters.`,
      )
    }
    const orderNode = this.#value(map, 'order')
    let order: SourceCollectionOrder = 'title'
    if (orderNode !== undefined) {
      const value = isScalar(orderNode) ? orderNode.value : undefined
      const known = SOURCE_COLLECTION_ORDERS.find((candidate) => candidate === value)
      if (known === undefined) {
        throw new Refused(
          this.#line(orderNode),
          `"${where}.order" must be one of ${SOURCE_COLLECTION_ORDERS.join(', ')}.`,
        )
      }
      order = known
    }
    return { slug, title: title.trim(), path: path.value, order }
  }

  #patterns(map: YAMLMap, key: string, prefix: string): readonly string[] {
    const node = this.#value(map, key)
    if (node === undefined) return []
    if (!isSeq(node))
      throw new Refused(this.#line(node), `"${prefix}${key}" must be a list of paths.`)
    if (node.items.length > MAX_MANIFEST_LIST) {
      throw new Refused(
        this.#line(node),
        `"${prefix}${key}" can list at most ${MAX_MANIFEST_LIST} paths.`,
      )
    }
    return node.items.map((item) => {
      const value = isScalar(item) ? item.value : undefined
      if (typeof value !== 'string') {
        throw new Refused(this.#line(item), `each of "${prefix}${key}" must be a path.`)
      }
      const pattern = checkSourcePattern(value)
      if (!pattern.ok) throw new Refused(this.#line(item), pattern.error)
      return pattern.value
    })
  }

  #redirects(map: YAMLMap, prefix: string): ManifestEntry['redirects'] {
    const node = this.#value(map, 'redirects')
    if (node === undefined) return []
    if (!isMap(node)) {
      throw new Refused(this.#line(node), `"${prefix}redirects" must map old paths to new paths.`)
    }
    if (node.items.length > MAX_MANIFEST_LIST) {
      throw new Refused(
        this.#line(node),
        `"${prefix}redirects" can name at most ${MAX_MANIFEST_LIST} paths.`,
      )
    }
    const seen = new Set<string>()
    return node.items.map((pair) => {
      const line = this.#line(pair.key)
      const from = checkSourcePath(this.#key(pair))
      const toValue = isScalar(pair.value) ? pair.value.value : undefined
      const to = checkSourcePath(typeof toValue === 'string' ? toValue : '')
      if (!from.ok) throw new Refused(line, `a redirect's old path: ${from.error}`)
      if (!to.ok)
        throw new Refused(line, `the redirect from "${from.value}" needs a new path: ${to.error}`)
      if (seen.has(from.value)) throw new Refused(line, `"${from.value}" is redirected twice.`)
      if (from.value === to.value)
        throw new Refused(line, `"${from.value}" is redirected to itself.`)
      seen.add(from.value)
      return [from.value, to.value] as const
    })
  }

  #slug(map: YAMLMap, where: string): string {
    const slug = this.#string(map, 'slug', where)
    if (slug.length === 0 || slugify(slug) !== slug) {
      throw new Refused(
        this.#line(this.#value(map, 'slug')),
        `"${slug}" is not a slug; try "${slugify(slug) || 'docs'}".`,
      )
    }
    return slug
  }

  #string(map: YAMLMap, key: string, where: string): string {
    const node = this.#value(map, key)
    const value = node !== undefined && isScalar(node) ? node.value : undefined
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    throw new Refused(this.#line(node ?? map), `"${where}.${key}" must be text.`)
  }

  #map(node: unknown, what: string, fallbackLine: number | null): YAMLMap {
    if (isMap(node)) return node
    throw new Refused(
      this.#line(node) ?? fallbackLine,
      `${what} must be a mapping of keys to values.`,
    )
  }

  #value(map: YAMLMap, key: string): Node | undefined {
    const value = map.items.find((candidate) => this.#key(candidate) === key)?.value
    return isNode(value) ? value : undefined
  }

  #key(pair: Pair): string {
    const key = pair.key
    if (isScalar(key) && (typeof key.value === 'string' || typeof key.value === 'number')) {
      return String(key.value)
    }
    throw new Refused(this.#line(key), 'every key must be text.')
  }

  #noteUnknown(map: YAMLMap, prefix: string, known: ReadonlySet<string>): void {
    for (const pair of map.items) {
      const key = this.#key(pair)
      if (!known.has(key))
        this.#unknown.push({ key: `${prefix}${key}`, line: this.#line(pair.key) })
    }
  }

  #line(node: unknown): number | null {
    const offset = isNode(node) ? node.range?.[0] : undefined
    return offset === undefined ? null : this.#lines.linePos(offset).line
  }
}

/**
 * What a collection the manifest gives no title is called: its file's name,
 * humanised, for a collection of one file, and otherwise its directory's (the
 * literal one in front of its path), as a folder with no README is named.
 */
export function collectionTitleOf(pattern: string): string {
  if (!isSourceGlob(pattern) && isDocumentPath(pattern)) return titleFromPath(pattern)
  return titleFromPath(`${sourcePatternPrefix(pattern)}/README.md`)
}
