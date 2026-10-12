import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Loads the demo's documents from `content/` (see `README.md` for the format).
 *
 * The files are the source of truth and are checked in, so the demo can be
 * reviewed in a diff and recreated byte for byte. This module only reads them;
 * what to do with them is `seed-demo.ts`'s concern.
 */

const CONTENT_ROOT = join(import.meta.dirname, 'content')

export type DemoStatus = 'published' | 'draft-ahead' | 'draft'

export interface DemoDocument {
  readonly workspace: string
  readonly slug: string
  readonly collection: string
  readonly title: string
  readonly type: string
  /** Addresses, `first@acme.example`: the first is the document's main author. */
  readonly owners: readonly string[]
  readonly tags: readonly string[]
  /** How often the document must be reviewed (`90d`), when it must be. */
  readonly review: string | undefined
  readonly status: DemoStatus
  /** One change note per revision, oldest first. */
  readonly notes: readonly string[]
  /** Extra front matter, merged over the generated fields. */
  readonly frontMatter: Readonly<Record<string, unknown>>
  /** The whole body at each published revision, oldest first. */
  readonly revisions: readonly string[]
  /** The unpublished draft: ahead of the last revision, or the only content. */
  readonly draft: string | undefined
}

interface DemoMeta {
  readonly collection: string
  readonly title: string
  readonly type: string
  readonly owners: readonly string[]
  readonly tags: readonly string[]
  readonly review?: string
  readonly status: DemoStatus
  readonly notes: readonly string[]
  readonly frontMatter: Readonly<Record<string, unknown>>
}

/** Every demo document, workspace by workspace, in a stable order. */
export function loadDemoContent(root: string = CONTENT_ROOT): readonly DemoDocument[] {
  return directories(root).flatMap((workspace) =>
    directories(join(root, workspace)).map((slug) =>
      loadDocument(join(root, workspace), workspace, slug),
    ),
  )
}

function loadDocument(workspaceRoot: string, workspace: string, slug: string): DemoDocument {
  const directory = join(workspaceRoot, slug)
  // The directory is the document's own authored file set, so reading the meta
  // as a `DemoMeta` is the loader's contract; the validation test pins it.
  const meta: DemoMeta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8'))
  const files = new Set(readdirSync(directory))
  return {
    workspace,
    slug,
    collection: meta.collection,
    title: meta.title,
    type: meta.type,
    owners: meta.owners,
    tags: meta.tags,
    review: meta.review,
    status: meta.status,
    notes: meta.notes,
    frontMatter: meta.frontMatter,
    revisions: revisionNumbers(files).map((number) => read(directory, `${number}.md`)),
    draft: files.has('draft.md') ? read(directory, 'draft.md') : undefined,
  }
}

/** Files authored on Windows may end their lines with CRLF; a document body never does. */
const read = (directory: string, file: string): string =>
  readFileSync(join(directory, file), 'utf8').replaceAll('\r\n', '\n')

const directories = (path: string): readonly string[] =>
  readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()

/** `1.md`, `2.md`, … in numeric order: `10.md` follows `9.md`, not `1.md`. */
const revisionNumbers = (files: ReadonlySet<string>): readonly number[] =>
  [...files]
    .map((file) => /^(\d+)\.md$/.exec(file)?.[1])
    .filter((digits) => digits !== undefined)
    .map(Number)
    .toSorted((a, b) => a - b)
