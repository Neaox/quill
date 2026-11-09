import type { DocumentId } from '@quill/domain'

import type { BlobStore } from '../ports/blob-store.ts'
import type { DrawingSource, DocumentFormat, RenderInput } from '../ports/document-format.ts'
import type { DrawingText } from '../ports/drawing-text.ts'
import type { ExternalSource, SourceChange, SourceRevisionId } from '../ports/external-source.ts'
import type { AttachmentId, CollectionId } from '../ports/persistence.ts'
import type {
  BrokenSourceLink,
  RefusedSourceFile,
  SourceCollection,
  SourceLinkSettings,
} from '../ports/source-sync.ts'
import type { Received } from './attachments.ts'
import { assembleRenderInput, drawingSources } from './render-document.ts'
import type { DrawnRenderInput } from './render-document.ts'
import { assetMatcher } from './source-assets.ts'
import { generatedFolderOf, withFolderAddresses } from './source-folders.ts'
import type { FolderPlan } from './source-folders.ts'
import { layoutPaths, layoutPlacer } from './source-layout.ts'
import type { LayoutCollection, SourceLayout } from './source-layout.ts'
import { outsideLinks, relativeDestinations, resolveSourceLinks } from './source-links.ts'
import type { SourceLinks } from './source-links.ts'
import type { ManifestProblem } from './source-manifest.ts'
import { isSourceDocument, readLayoutAt, readSourceContents } from './source-plan.ts'
import {
  arrangeSiblings,
  assetRefusedUnread,
  brokenSourceLinks,
  byCodePoint,
  compareBrokenLinks,
  planRevisionEdits,
  relativeLinkTargets,
  takeInSourceAsset,
} from './source-revision.ts'
import type { PlacedEdit, WriteEdit } from './source-revision.ts'

/**
 * What a first sync of one revision would make of a source (ADR-062), with
 * nothing written: the layout, every document with its collection, parent,
 * title and order, the files refused and why, the assets taken in, the
 * broken links, and each document's render input.
 *
 * It asks every question the sync job asks of a workspace that holds
 * nothing yet, through the same functions (`source-plan.ts`,
 * `source-revision.ts`, `source-layout.ts`, `source-folders.ts`,
 * `source-links.ts`): the sync of a source whose history setting is `head`
 * writes exactly this plan. The parity suite holds both to the same golden
 * files (`apps/server/src/infrastructure/sources/__goldens__`).
 *
 * The only thing it makes is ids, which its caller mints: the server's
 * sync mints random ones, and the command-line tool mints them from paths
 * so a body's cache key survives a run.
 */

export interface SourceHeadPlanDependencies {
  readonly format: Pick<DocumentFormat, 'stampIdentity' | 'read' | 'links'>
  /** Where an asset's bytes go once taken in, as an upload's do. */
  readonly blobStore: BlobStore
  readonly drawingText: DrawingText
  /** The upload cap, which an asset is held to as well. */
  readonly maxAssetBytes: number
  readonly ids: {
    /** The id of the document first seen at this path. */
    readonly document: (path: string) => DocumentId
    /** The id of the collection a manifest names by this slug. */
    readonly collection: (slug: string) => CollectionId
    /** The id of the attachment that holds these bytes. */
    readonly attachment: (sha256: string) => AttachmentId
  }
}

export interface SourceHeadPlanCommand {
  /** A revision the source has fetched. */
  readonly revision: SourceRevisionId
  /** The source's settings collections, which place the files when there is no manifest. */
  readonly collections: readonly SourceCollection[]
  /** Which of the manifest's workspaces to read when it describes several: the workspace's slug. */
  readonly entry: string
  /** Where links outside the source go. */
  readonly links: SourceLinkSettings & { readonly remote: string }
}

/** A collection the layout names, as the sync makes it. */
export interface PlannedCollection {
  readonly id: CollectionId
  readonly collection: LayoutCollection
}

/** A document of the plan, placed as the sync places it. */
export interface PlannedDocument {
  readonly documentId: DocumentId
  readonly collectionId: CollectionId
  /** The stored path: the repository path, or a generated folder document's path. */
  readonly path: string
  /** The folder it stands for, when it is a folder's document. */
  readonly folder: string | null
  readonly generated: boolean
  /** The stored path of the document it nests under; null at the top of its collection. */
  readonly parent: string | null
  readonly title: string
  readonly sortKey: number
  /** The stored copy: the repository's text with its id stamped in. */
  readonly markdown: string
  /** Its relative links and images, resolved against the plan. */
  readonly links: SourceLinks
}

/** An asset the plan takes in. */
export interface PlannedAsset {
  readonly path: string
  readonly attachmentId: AttachmentId
  readonly received: Received
}

export type SourceHeadPlan =
  | {
      readonly kind: 'unreadable'
      readonly revision: SourceRevisionId
      /** The manifest problem that stops a sync, with its line. */
      readonly problem: ManifestProblem
      /** The manifest read, but names no workspace by the entry asked for. */
      readonly entryMissing: boolean
    }
  | {
      readonly kind: 'planned'
      readonly revision: SourceRevisionId
      readonly layout: SourceLayout
      readonly collections: readonly PlannedCollection[]
      /** By stored path, in path order. */
      readonly documents: readonly PlannedDocument[]
      readonly folders: FolderPlan<CollectionId>
      /** In path order. */
      readonly refused: readonly RefusedSourceFile[]
      /** In path order. */
      readonly assets: readonly PlannedAsset[]
      /** In the order the sync lists them. */
      readonly brokenLinks: readonly BrokenSourceLink[]
      /** Markdown files under the layout's paths that it leaves out, with the pattern that excluded each; in path order. */
      readonly leftOut: readonly { readonly path: string; readonly pattern: string | null }[]
    }

export async function planSourceHead(
  deps: SourceHeadPlanDependencies,
  source: ExternalSource,
  command: SourceHeadPlanCommand,
): Promise<SourceHeadPlan> {
  const { revision } = command
  const read = await readLayoutAt(source, revision, {
    collections: command.collections,
    entry: command.entry,
  })
  if (!read.ok) {
    return {
      kind: 'unreadable',
      revision,
      problem: read.problem,
      entryMissing: read.manifest !== null,
    }
  }
  const { layout } = read
  await source.narrow(layoutPaths(layout))

  // The layout's collections as the sync resolves them for a workspace that has none.
  const ids = new Map<LayoutCollection, CollectionId>(
    layout.collections.map((collection) => [
      collection,
      collection.from === 'settings'
        ? collection.collectionId
        : deps.ids.collection(collection.slug),
    ]),
  )
  const placer = layoutPlacer(layout)
  const refused = new Map<string, RefusedSourceFile>()

  // The whole revision as added, as a first sync's one revision reads it.
  const files = []
  for await (const file of source.files(revision)) files.push(file)
  const changes = files.map((file): SourceChange => ({ kind: 'added', file }))
  const { edits, folders } = await planRevisionEdits(
    {
      source,
      format: deps.format,
      mintDocumentId: deps.ids.document,
      placer: () => placer,
      refused,
    },
    { changes, revision, paths: new Map(), layout, replan: true, ids },
  )
  const placed = edits.filter((edit): edit is PlacedEdit => edit.kind !== 'archive')
  const written = placed.filter((edit): edit is WriteEdit => edit.kind === 'write')

  const assets = await takeInAssets(deps, source, revision, files, layout, placer, refused)

  // Each collection arranged as the sync arranges it once the revision is written.
  const arranged = new Map<string, { readonly parent: string | null; readonly sortKey: number }>()
  // Keyed by path: a head plan's documents are one per path.
  const orders = new Map(placed.map((edit) => [edit.path, edit.order]))
  for (const [collection, id] of ids) {
    const members = placed
      .filter((edit) => edit.collectionId === id)
      .map((edit) => ({
        id: edit.path,
        path: edit.path,
        title: edit.title,
        createdAt: EPOCH,
      }))
    for (const { item, parentId, sortKey } of arrangeSiblings(members, {
      folders,
      orders,
      rule: collection.order,
    })) {
      arranged.set(item.path, { parent: parentId, sortKey })
    }
  }

  // Relative links and images, against the plan's own documents and assets.
  const documentsByPath = withFolderAddresses(
    new Map(written.map((edit) => [edit.path, edit.documentId])),
  )
  const assetMap = new Map(assets.map(({ path, attachmentId }) => [path, attachmentId]))
  const outside = outsideLinks(command.links, revision)
  const documents = written
    .map((edit): PlannedDocument => {
      const folder = generatedFolderOf(edit.path) ?? folders.folderOf.get(edit.path) ?? null
      const place = arranged.get(edit.path)
      /* v8 ignore next -- every written document is in one of the layout's collections. */
      if (place === undefined) throw new Error(`${edit.path} was placed in no collection.`)
      return {
        documentId: edit.documentId,
        collectionId: edit.collectionId,
        path: edit.path,
        folder,
        generated: generatedFolderOf(edit.path) !== null,
        parent: place.parent,
        title: edit.title,
        sortKey: place.sortKey,
        markdown: edit.markdown,
        links: resolveSourceLinks(relativeDestinations(edit.markdown), {
          path: edit.path,
          documents: documentsByPath,
          outside,
          assets: assetMap,
        }),
      }
    })
    .toSorted((left, right) => byCodePoint(left.path, right.path))

  const found = written.flatMap((edit) =>
    relativeLinkTargets(deps.format, edit.path, edit.markdown),
  )
  const brokenLinks = (await brokenSourceLinks(source, revision, found, layout.redirects)).toSorted(
    compareBrokenLinks,
  )

  const leftOut = files
    .filter((file) => isSourceDocument(file.path))
    .flatMap((file) => {
      const placement = placer.placement(file.path)
      if (placement.kind === 'placed') return []
      return [
        { path: file.path, pattern: placement.kind === 'excluded' ? placement.pattern : null },
      ]
    })
    .toSorted((left, right) => byCodePoint(left.path, right.path))

  return {
    kind: 'planned',
    revision,
    layout,
    collections: [...ids].map(([collection, id]) => ({ id, collection })),
    documents,
    folders,
    refused: [...refused.values()].toSorted((left, right) => byCodePoint(left.path, right.path)),
    assets: assets.toSorted((left, right) => byCodePoint(left.path, right.path)),
    brokenLinks,
    leftOut,
  }
}

/**
 * A planned document's render input, assembled as a reader's render
 * assembles it (`renderInputFor`): its stored Markdown, the titles of the
 * plan's documents it links to, the drawings it shows, the organisation's
 * vocabulary, and its resolved links and images.
 */
export async function plannedRenderInput(
  plan: Extract<SourceHeadPlan, { kind: 'planned' }>,
  document: PlannedDocument,
  context: {
    readonly blobStore: BlobStore
    readonly vocabulary: Pick<RenderInput, 'labels' | 'emoji' | 'labelEmoji'>
  },
): Promise<DrawnRenderInput> {
  const titles = new Map(plan.documents.map((planned) => [planned.documentId, planned.title]))
  const linkTitles = new Map<DocumentId, string>()
  for (const target of document.links.targets) {
    const title = titles.get(target)
    /* v8 ignore next -- a link resolves to a document only when the plan has it. */
    if (title !== undefined) linkTitles.set(target, title)
  }
  const shown = new Set(document.links.attachments)
  const drawings: ReadonlyMap<string, DrawingSource> = await drawingSources(
    context.blobStore,
    plan.assets
      .filter(({ attachmentId }) => shown.has(attachmentId))
      .map(({ attachmentId, received }) => ({
        id: attachmentId,
        contentType: received.contentType,
        size: received.size,
        sha256: received.sha256,
      })),
  )
  return assembleRenderInput({
    markdown: document.markdown,
    linkTitles,
    drawings,
    vocabulary: context.vocabulary,
    sourced: document.links,
  })
}

/** When every document of a head plan first appeared: together, so no rule tells them apart by it. */
const EPOCH = new Date(0)

/**
 * The revision's assets as the sync takes them in on a first sync: each
 * file the layout calls an asset, through the upload's intake, one
 * attachment per distinct content.
 */
async function takeInAssets(
  deps: SourceHeadPlanDependencies,
  source: ExternalSource,
  revision: SourceRevisionId,
  files: readonly {
    readonly path: string
    readonly fileId: string
    readonly kind: 'file' | 'symbolic-link'
  }[],
  layout: SourceLayout,
  placer: ReturnType<typeof layoutPlacer>,
  refused: Map<string, RefusedSourceFile>,
): Promise<PlannedAsset[]> {
  const isAsset = assetMatcher(layout, placer)
  const wanted = files.filter((file) => isAsset(file.path))
  const readable = wanted.filter((file) => {
    const unread = assetRefusedUnread(file)
    if (unread === null) return true
    refused.set(file.path, { path: file.path, revision, reason: unread.reason })
    return false
  })
  const contents = await readSourceContents(source, readable)
  const assets: PlannedAsset[] = []
  // oxlint-disable-next-line quill/no-independent-await-in-loop -- one file's bytes at a time, as the sync takes them
  for (const file of readable) {
    const content = contents.get(file.fileId)
    /* v8 ignore next -- the source returns what it listed. */
    if (content === undefined) continue
    const intake = await takeInSourceAsset(deps, file, content)
    if (intake.kind === 'refused') {
      refused.set(file.path, { path: file.path, revision, reason: intake.reason })
      continue
    }
    refused.delete(file.path)
    assets.push({
      path: file.path,
      attachmentId: deps.ids.attachment(intake.received.sha256),
      received: intake.received,
    })
  }
  return assets
}
