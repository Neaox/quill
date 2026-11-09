import { defaultForgeViewTemplate, forgeViewUrl } from '@quill/domain'
import type { DocumentId, RevisionId } from '@quill/domain'

import type { ContentStore } from '../ports/content-store.ts'
import type { ResolvedDestination } from '../ports/document-format.ts'
import type { DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import type { SourceLinkSettings } from '../ports/source-sync.ts'
import { documentUrl } from './document-path.ts'

/**
 * Relative links in a sourced document, resolved at render (ADR-061,
 * "Relative links, resolved at render").
 *
 * A file read from a repository links to its neighbours the way the
 * repository does: `../adr/0012-auth.md#token-rotation`. The stored copy is
 * never rewritten, so a compare shows only what the source changed; instead
 * each link is resolved against the document's own path and the documents of
 * the revision being rendered, and the answer is part of the render input,
 * so the cache key covers it and the cached body is the same for every
 * reader (ADR-031). Whether one reader may follow a link to another document
 * is decided per request, after the cache (`surface-links.ts`).
 *
 * A link that names a document of the revision goes to its canonical address
 * and the heading its fragment names. Any other path in the repository goes
 * to the forge at the commit the page was synced from, or is shown as its
 * words when the source asks for that or no forge address is known. A path
 * that climbs out of the repository leads nowhere and is shown as words.
 */

/** What every rendered heading's id starts with (`@quill/markdown`'s `HEADING_ID_PREFIX`). */
export const HEADING_ANCHOR_PREFIX = 'user-content-'

const TEXT: ResolvedDestination = { kind: 'text' }
const SCHEME = /^[a-z][a-z0-9+.-]*:/iu

/** An inline destination: `](…)`, in angle brackets or bare with balanced parentheses. */
const INLINE_DESTINATION = /\]\(\s*(?:<([^<>\n]*)>|((?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))+))/gu
/** A reference definition's destination: `[label]: …` at the start of a line. */
const DEFINITION_DESTINATION = /^ {0,3}\[(?:[^\]\\\n]|\\.)+\]:[ \t]*(?:<([^<>\n]*)>|(\S+))/gmu
/** A backslash escape, which the parser removes from a destination. */
const ESCAPED_PUNCTUATION = /\\([!-/:-@[-`{-~])/gu

/**
 * Whether a destination is relative to the file it is written in: not an
 * address with a scheme, not one from the root or another host, and not a
 * section of the same page.
 */
export function isRelativeDestination(url: string): boolean {
  return url !== '' && !SCHEME.test(url) && !/^[/\\#?]/u.test(url)
}

/**
 * Every relative destination a piece of Markdown may hold, as the parser
 * will read it, without parsing it: so the links can be resolved *before*
 * the render that needs them.
 *
 * Deliberately generous, like `linkedDocumentReferences`: a destination
 * inside a code block is found too, which costs one entry in the render
 * input and never a wrong body, because only a link the parser finds is
 * ever drawn from it.
 */
export function relativeDestinations(markdown: string): ReadonlySet<string> {
  const found = new Set<string>()
  for (const pattern of [INLINE_DESTINATION, DEFINITION_DESTINATION]) {
    for (const [, bracketed, bare] of markdown.matchAll(pattern)) {
      /* v8 ignore next -- each pattern's alternatives capture one group or the other. */
      const url = (bracketed ?? bare ?? '').replaceAll(ESCAPED_PUNCTUATION, '$1')
      if (isRelativeDestination(url)) found.add(url)
    }
  }
  return found
}

/** A relative destination's path in the repository, and the section it names. */
export interface RepositoryTarget {
  readonly path: string
  readonly fragment: string | null
}

/**
 * Where a relative destination written in the file at `from` points, as the
 * forge resolves it: against the file's directory, `.` and `..` walked, a
 * query dropped, the path percent-decoded. Null when it climbs out of the
 * repository or does not decode: it names nothing there.
 */
export function repositoryTarget(from: string, url: string): RepositoryTarget | null {
  const hash = url.indexOf('#')
  const fragment = hash === -1 || hash === url.length - 1 ? null : url.slice(hash + 1)
  const beforeHash = hash === -1 ? url : url.slice(0, hash)
  const query = beforeHash.indexOf('?')
  const raw = query === -1 ? beforeHash : beforeHash.slice(0, query)
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const segments = from.split('/').slice(0, -1)
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return { path: segments.join('/'), fragment }
}

/** What links in one document are resolved against. */
export interface SourceLinkContext {
  /** The document's own path in the repository. */
  readonly path: string
  /** The documents of the revision being rendered, by their paths. */
  readonly documents: ReadonlyMap<string, DocumentId>
  /** The forge's address for a repository path at the synced commit; null to show such links as text. */
  readonly outside: ((path: string) => string) | null
}

/** The section of a rendered document a fragment written against the forge names. */
function headingAnchor(fragment: string): string {
  return fragment.startsWith(HEADING_ANCHOR_PREFIX)
    ? fragment
    : `${HEADING_ANCHOR_PREFIX}${fragment}`
}

/** Each destination's resolution, and the documents they name. */
export function resolveSourceLinks(
  urls: Iterable<string>,
  context: SourceLinkContext,
): {
  readonly resolved: ReadonlyMap<string, ResolvedDestination>
  readonly targets: ReadonlySet<DocumentId>
} {
  const resolved = new Map<string, ResolvedDestination>()
  const targets = new Set<DocumentId>()
  for (const url of urls) {
    const target = repositoryTarget(context.path, url)
    if (target === null) {
      resolved.set(url, TEXT)
      continue
    }
    const section = target.fragment
    const id = context.documents.get(target.path)
    if (id !== undefined) {
      targets.add(id)
      const anchor = section === null ? '' : `#${headingAnchor(section)}`
      resolved.set(url, { kind: 'href', href: `${documentUrl(id)}${anchor}` })
    } else if (context.outside !== null) {
      const anchor = section === null ? '' : `#${section}`
      resolved.set(url, { kind: 'href', href: `${context.outside(target.path)}${anchor}` })
    } else {
      resolved.set(url, TEXT)
    }
  }
  return { resolved, targets }
}

/** The forge's address for a repository path at a commit, or null when links outside are text. */
export function outsideLinks(
  settings: SourceLinkSettings & { readonly remote: string },
  commit: string | null,
): ((path: string) => string) | null {
  if (settings.outsideLinks === 'text' || commit === null) return null
  const template = settings.viewTemplate ?? defaultForgeViewTemplate(settings.remote)
  return template === null ? null : (path) => forgeViewUrl(template, commit, path)
}

/** Where a published document sits in the revision being rendered. */
export interface SourcePlace {
  readonly path: string
  readonly revision: RevisionId
  /**
   * True for the published head, whose links to the forge go to the commit
   * the workspace is synced to; false for an older revision, whose go to
   * that revision's own commit.
   */
  readonly head: boolean
}

export interface SourceLinksDependencies {
  readonly uow: UnitOfWork
  readonly contentStore: ContentStore
}

const NONE = { resolved: new Map<string, ResolvedDestination>(), targets: new Set<DocumentId>() }

/**
 * The relative links of a document at a place, resolved; none for a
 * document of a native workspace, or one with no relative link.
 *
 * The source's settings are read only when the text holds a relative
 * destination, and the revision's documents only when the workspace is
 * sourced, so a native body costs nothing it did not cost before.
 */
export async function sourceLinksAt(
  deps: SourceLinksDependencies,
  document: DocumentRow,
  markdown: string,
  place: SourcePlace,
): Promise<ReturnType<typeof resolveSourceLinks>> {
  const urls = relativeDestinations(markdown)
  if (urls.size === 0) return NONE
  const { repos } = deps.uow
  const settings = await repos.workspaceSources.find(document.workspaceId)
  if (settings === null) return NONE
  const [tree, commit] = await Promise.all([
    deps.contentStore.listTree(document.workspaceId, place.revision),
    syncedCommit(deps.uow, document, place),
  ])
  const documents = new Map(
    tree.flatMap((entry) =>
      entry.documentId === undefined ? [] : [[entry.path, entry.documentId] as const],
    ),
  )
  return resolveSourceLinks(urls, {
    path: place.path,
    documents,
    outside: outsideLinks(settings, commit),
  })
}

/** The source revision a place was synced from, or null when none is recorded. */
async function syncedCommit(
  uow: UnitOfWork,
  document: DocumentRow,
  place: SourcePlace,
): Promise<string | null> {
  if (place.head) {
    const state = await uow.repos.sourceSyncState.find(document.workspaceId)
    return state?.lastSyncedRevision ?? null
  }
  const row = await uow.repos.revisions.findForDocument(document.id, place.revision)
  return row?.sourceRevision ?? null
}
