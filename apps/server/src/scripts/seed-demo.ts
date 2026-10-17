import {
  createDocument,
  documentUrl,
  namedSlug,
  publishCollection,
  publishDocument,
  readOrganisationSettings,
  renderDocument,
  updateOrganisationSettings,
} from '@quill/application'
import type { PublishedOutcome, UnitId } from '@quill/application'
import type { CollectionId, DocumentId, UserId, WorkspaceId } from '@quill/domain'
import { parseDocument } from '@quill/markdown'

import type { AppDependencies } from '../dependencies.ts'
import { loadDemoContent } from './demo/content.ts'
import type { DemoDocument } from './demo/content.ts'
import {
  DEMO_LABELS,
  DEMO_ORGANISATION_NAME,
  DEMO_PASSWORD,
  DEMO_PEOPLE,
  DEMO_UNITS,
  DEMO_WORKSPACES,
} from './demo/structure.ts'
import type { DemoWorkspace } from './demo/structure.ts'
import { ADMIN_EMAIL, WRITER_EMAIL } from './seed-accounts.ts'
import { ensureCollections, ensureGrant, ensureUnit, ensureUser, ensureWorkspace } from './seed.ts'

/**
 * A believable company's documentation on top of the development seed: two
 * products, eleven workspaces, public sites and private ones, documents with a
 * history, some with a draft ahead of what is published and some never
 * published (`demo/README.md` describes the premise and the files).
 *
 * Like the development seed it goes through the use cases the API uses, so
 * revisions, render cache and link index are what real use would leave. It
 * backdates each revision, by handing the use cases a clock that says when
 * that revision happened, so history reads as months of work rather than a
 * minute of it. Documents that already exist are left alone, so it is safe to
 * run twice.
 */

/** The seed holds no editor session; this names it in the one place a publish asks (ADR-021). */
const SEED_SESSION = 'seed'
const COMPANY_UNIT = 'Acme'

export interface DemoSeedResult {
  readonly workspaces: number
  readonly documents: number
  readonly revisions: number
  readonly publicSites: number
  /** Anything the publish pipeline objected to, as `Title (revision N): what`; empty when the content is clean. */
  readonly problems: readonly string[]
}

interface Author {
  readonly userId: UserId
  readonly name: string
  readonly email: string
}

/** A demo document once it exists: where it lives and the id links point at. */
interface Placed {
  readonly document: DemoDocument
  readonly id: DocumentId
  readonly workspaceId: WorkspaceId
  readonly collectionId: CollectionId
  /** When each revision happened, oldest first. */
  readonly revisionTimes: readonly Date[]
}

export async function seedDemoData(deps: AppDependencies): Promise<DemoSeedResult> {
  const admin = await requireUser(deps, ADMIN_EMAIL)
  const writer = await requireUser(deps, WRITER_EMAIL)
  const authors = await ensurePeople(deps)
  const content = loadDemoContent()

  const workspaces = await ensureStructure(deps, { admin, writer, authors, content })
  await ensureOrganisationSettings(deps, admin)

  const placed = await createDocuments(deps, { admin, workspaces, content })
  const idsByTitle = new Map(placed.map(({ document, id }) => [document.title, id]))
  const problems: string[] = []
  for (const entry of placed) {
    problems.push(...(await writeHistory(deps, { entry, authors, idsByTitle })))
  }

  const publicSites = await publishPublicSites(deps, { admin, placed, workspaces })
  return {
    workspaces: workspaces.size,
    documents: placed.length,
    revisions: placed.reduce((count, { document }) => count + document.revisions.length, 0),
    publicSites,
    problems,
  }
}

async function requireUser(deps: AppDependencies, email: string): Promise<UserId> {
  const user = await deps.uow.repos.users.findByEmail(email)
  if (user === null) throw new Error(`Seed the development accounts first: ${email} is missing.`)
  return user.id
}

async function ensurePeople(deps: AppDependencies): Promise<ReadonlyMap<string, Author>> {
  const authors = new Map<string, Author>()
  for (const person of DEMO_PEOPLE) {
    const userId = await ensureUser(deps, {
      email: person.email,
      password: DEMO_PASSWORD,
      displayName: person.name,
      isInstanceAdmin: false,
    })
    authors.set(person.email, { userId, name: person.name, email: person.email })
  }
  return authors
}

interface StructureInput {
  readonly admin: UserId
  readonly writer: UserId
  readonly authors: ReadonlyMap<string, Author>
  readonly content: readonly DemoDocument[]
}

/** The divisions, the workspaces under them, and who may read or edit each. */
async function ensureStructure(
  deps: AppDependencies,
  input: StructureInput,
): Promise<ReadonlyMap<string, WorkspaceId>> {
  const company = await ensureUnit(deps, { name: COMPANY_UNIT, label: 'company', parentId: null })
  const units = new Map<string, UnitId>()
  for (const name of DEMO_UNITS) {
    units.set(name, await ensureUnit(deps, { name, label: 'division', parentId: company }))
  }

  const workspaces = new Map<string, WorkspaceId>()
  for (const workspace of DEMO_WORKSPACES) {
    const unitId = units.get(workspace.unit)
    /* v8 ignore next -- every workspace's unit is created just above. */
    if (unitId === undefined) throw new Error(`No unit ${workspace.unit}`)
    const id = await ensureWorkspace(deps, { name: workspace.name, slug: workspace.slug, unitId })
    workspaces.set(workspace.slug, id)
    await ensureAccess(deps, { ...input, workspace, workspaceId: id })
  }
  return workspaces
}

interface AccessInput extends StructureInput {
  readonly workspace: DemoWorkspace
  readonly workspaceId: WorkspaceId
}

/**
 * Whoever owns a workspace's documents can edit there; for a company or public
 * workspace the rest of the staff can read it. The development writer is
 * granted what the structure says, so one demo shows an editor, a reader and
 * somebody who cannot see a workspace at all.
 */
async function ensureAccess(deps: AppDependencies, input: AccessInput): Promise<void> {
  const { admin, authors, workspace, workspaceId } = input
  const editors = new Set(
    input.content
      .filter((document) => document.workspace === workspace.slug)
      .flatMap((document) => document.owners),
  )
  for (const email of editors) {
    await ensureGrant(deps, { admin, userId: userOf(authors, email), workspaceId, role: 'editor' })
  }
  if (workspace.audience !== 'team') {
    for (const person of DEMO_PEOPLE.filter(({ email }) => !editors.has(email))) {
      await ensureGrant(deps, {
        admin,
        userId: userOf(authors, person.email),
        workspaceId,
        role: 'viewer',
      })
    }
  }
  if (workspace.writer !== 'none') {
    await ensureGrant(deps, {
      admin,
      userId: input.writer,
      workspaceId,
      role: workspace.writer,
    })
  }
}

function userOf(authors: ReadonlyMap<string, Author>, email: string): UserId {
  const author = authors.get(email)
  /* v8 ignore next -- `content.test.ts` pins every owner to a demo person. */
  if (author === undefined) throw new Error(`Demo content names ${email}, who is not a demo person`)
  return author.userId
}

/**
 * The organisation's name, its labels, and permission to publish sites. Labels
 * live in the theme, and the first change forks the built-in the same way the
 * settings screens do, so the fork keeps the built-in's values.
 */
async function ensureOrganisationSettings(deps: AppDependencies, admin: UserId): Promise<void> {
  const current = await readOrganisationSettings(deps)
  /* v8 ignore next -- a freshly migrated database has readable (or no) settings. */
  if (current.kind === 'unreadable') throw new Error(`Settings unreadable: ${current.reason}`)
  if (current.document.name === DEMO_ORGANISATION_NAME) return

  const { theme, policies } = current.document
  const result = await updateOrganisationSettings(deps, {
    document: {
      ...current.document,
      name: DEMO_ORGANISATION_NAME,
      theme: {
        ...theme,
        id: 'organisation-theme',
        name: `${DEMO_ORGANISATION_NAME} theme`,
        base: theme.base ?? theme.id,
        labels: DEMO_LABELS,
      },
      policies: { ...policies, publicPublishingAllowed: true },
    },
    expectedRevision: current.revision,
    actor: admin,
    author: { name: 'Instance administrator', email: ADMIN_EMAIL },
    changeNote: 'Set up the demo organisation',
  })
  /* v8 ignore next -- the settings written here are known good. */
  if (result.kind !== 'updated') throw new Error(`Demo settings refused: ${result.kind}`)
}

interface CreateInput {
  readonly admin: UserId
  readonly workspaces: ReadonlyMap<string, WorkspaceId>
  readonly content: readonly DemoDocument[]
}

/**
 * Creates every document first, across every workspace, because documents link
 * to each other by title and a link needs the other end's id.
 */
async function createDocuments(
  deps: AppDependencies,
  input: CreateInput,
): Promise<readonly Placed[]> {
  const collections = new Map<string, ReadonlyMap<string, CollectionId>>()
  for (const [slug, workspaceId] of input.workspaces) {
    const names = new Set(
      input.content
        .filter(({ workspace }) => workspace === slug)
        .map(({ collection }) => collection),
    )
    collections.set(slug, await ensureCollections(deps, workspaceId, [...names]))
  }

  const placed: Placed[] = []
  for (const [ordinal, document] of input.content.entries()) {
    const workspaceId = input.workspaces.get(document.workspace)
    const collectionId = collections.get(document.workspace)?.get(document.collection)
    /* v8 ignore next -- every document's workspace and collection are created just above. */
    if (workspaceId === undefined || collectionId === undefined) throw new Error(document.title)

    const revisionTimes = scheduleRevisions(deps.clock.now(), ordinal, document)
    const path = `${namedSlug(document.collection)}/${namedSlug(document.title)}.md`
    const existing = await deps.uow.repos.documents.findByPath(workspaceId, path)
    if (existing !== null) continue

    const created = await createDocument(
      { ...deps, clock: clockAt(createdBefore(deps.clock.now(), revisionTimes)) },
      {
        workspaceId,
        collectionId,
        parentId: null,
        title: document.title,
        createdBy: input.admin,
      },
    )
    /* v8 ignore next -- the collection and the title are both known good here. */
    if (created.kind !== 'created') throw new Error(`Demo create failed: ${created.kind}`)
    placed.push({ document, id: created.document.id, workspaceId, collectionId, revisionTimes })
  }
  return placed
}

interface HistoryInput {
  readonly entry: Placed
  readonly authors: ReadonlyMap<string, Author>
  readonly idsByTitle: ReadonlyMap<string, DocumentId>
}

/**
 * Publishes each revision in order, as its author, at its time; then leaves
 * the draft where the document's status says: level with the last revision,
 * ahead of it, or (for a document never published) holding everything there is.
 */
async function writeHistory(
  deps: AppDependencies,
  input: HistoryInput,
): Promise<readonly string[]> {
  const { entry } = input
  const { document } = entry
  const resolve = (body: string): string => withDocumentLinks(body, input.idsByTitle)
  const problems: string[] = []

  for (const [index, body] of document.revisions.entries()) {
    const at = entry.revisionTimes[index]
    /* v8 ignore next -- one time is scheduled for every revision. */
    if (at === undefined) throw new Error(document.title)
    const author = authorOf(input.authors, document, index)
    const timed = { ...deps, clock: clockAt(at) }

    await writeDraft(timed, entry, resolve(body), lastReviewed(at, document))
    const published = await publishDocument(timed, {
      documentId: entry.id,
      base: await deps.contentStore.head(entry.workspaceId),
      author,
      sessionId: SEED_SESSION,
      changeNote: document.notes[index],
    })
    /* v8 ignore next -- the demo publishes at the head it just read. */
    if (published.kind !== 'published') throw new Error(`${document.title}: ${published.kind}`)
    problems.push(...objections(document, index, published))

    // In a running server the render-on-publish consumer renders every
    // revision; rendering the last inline means a fresh instance reads at once.
    if (index === document.revisions.length - 1) {
      await renderDocument(timed, { documentId: entry.id, revision: published.revision })
    }
  }

  if (document.draft !== undefined) {
    const at = draftTime(deps.clock.now(), entry)
    await writeDraft({ ...deps, clock: clockAt(at) }, entry, resolve(document.draft), undefined)
  }
  return problems
}

/** What the publish pipeline said was wrong with a revision, worded for whoever fixes the content. */
export function objections(
  document: DemoDocument,
  revision: number,
  published: Pick<
    PublishedOutcome,
    'warnings' | 'frontMatterIssues' | 'incompleteRequiredSections'
  >,
): readonly string[] {
  // A template is made of placeholders and unanswered sections, on purpose.
  const isTemplate = document.type === 'template'
  return [
    ...published.warnings
      .filter(({ code }) => !isTemplate || code !== 'placeholder-remains')
      .map(({ code, detail }) => `${code}: ${detail}`),
    ...published.frontMatterIssues.map(({ path, message }) => `front matter ${path}: ${message}`),
    ...(isTemplate
      ? []
      : published.incompleteRequiredSections.map((section) => `incomplete section ${section}`)),
  ].map((what) => `${document.title} (revision ${revision + 1}): ${what}`)
}

/** Replaces the draft with `body`, exactly as the editor would leave it. */
async function writeDraft(
  deps: AppDependencies,
  entry: Placed,
  body: string,
  lastReviewedOn: string | undefined,
): Promise<void> {
  const { ast } = parseDocument(body)
  await deps.uow.repos.drafts.rebase({
    documentId: entry.id,
    baseRevision: await deps.contentStore.head(entry.workspaceId),
    ast: { version: 1, frontMatter: frontMatterOf(entry, lastReviewedOn), ast },
    now: deps.clock.now(),
  })
}

function frontMatterOf(entry: Placed, lastReviewedOn: string | undefined) {
  const { document } = entry
  return {
    id: entry.id,
    title: document.title,
    type: document.type,
    owners: document.owners,
    tags: document.tags,
    ...(document.review === undefined
      ? {}
      : {
          review: {
            interval: document.review,
            ...(lastReviewedOn === undefined ? {} : { lastReviewed: lastReviewedOn }),
          },
        }),
    ...document.frontMatter,
  }
}

const lastReviewed = (at: Date, { review }: DemoDocument): string | undefined =>
  review === undefined ? undefined : at.toISOString().slice(0, 10)

/** Each revision is by the next owner in turn, so a long history has more than one author. */
function authorOf(
  authors: ReadonlyMap<string, Author>,
  document: DemoDocument,
  revision: number,
): Author {
  /* v8 ignore next -- every document has an owner and every owner is a demo person. */
  const author = authors.get(document.owners[revision % document.owners.length] ?? '')
  /* v8 ignore next -- see above. */
  if (author === undefined) throw new Error(`${document.title} has no usable owner`)
  return author
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Spreads a document's revisions back from "now": the newest a few weeks ago,
 * each earlier one a document-specific interval before it. Derived from the
 * document's position so two runs agree, and varied so the timelines differ.
 */
function scheduleRevisions(now: Date, ordinal: number, document: DemoDocument): readonly Date[] {
  const interval = 12 + (ordinal % 17)
  const offset = ordinal % 6
  const count = document.revisions.length
  return document.revisions.map((_, index) => {
    const daysAgo = (count - index) * interval + offset
    const hour = 9 + ((ordinal + index) % 8)
    const at = new Date(now.getTime() - daysAgo * DAY_MS)
    at.setUTCHours(hour, (ordinal * 7 + index * 13) % 60, 0, 0)
    return at
  })
}

/** An hour before its first revision, or a few days ago when it has none. */
function createdBefore(now: Date, times: readonly Date[]): Date {
  const [first] = times
  return new Date((first ?? now).getTime() - 60 * 60 * 1000)
}

/**
 * A draft was last touched within the last five days. Revisions are scheduled
 * at least twelve days back, so a draft is always newer than the last one.
 */
const draftTime = (now: Date, { document }: Placed): Date =>
  new Date(now.getTime() - (1 + (document.title.length % 5)) * DAY_MS)

const clockAt = (at: Date): { now(): Date } => ({ now: () => at })

/**
 * Turns `[text](doc:Exact Title)` into the canonical id URL (ADR-031). A title
 * with no document behind it is an authoring mistake, and the demo's
 * validation test names it, so here it is an error rather than a dead link.
 */
export function withDocumentLinks(
  markdown: string,
  idsByTitle: ReadonlyMap<string, DocumentId>,
): string {
  return markdown.replace(/\]\(doc:([^)]+)\)/g, (_match, title: string) => {
    const id = idsByTitle.get(title)
    if (id === undefined) throw new Error(`No demo document is titled “${title}”`)
    return `](${documentUrl(id)})`
  })
}

interface PublishSitesInput {
  readonly admin: UserId
  readonly placed: readonly Placed[]
  readonly workspaces: ReadonlyMap<string, WorkspaceId>
}

/** Every collection of a public workspace becomes a site, opening on its first published document. */
async function publishPublicSites(
  deps: AppDependencies,
  input: PublishSitesInput,
): Promise<number> {
  const publicWorkspaces = new Set(
    DEMO_WORKSPACES.filter(({ audience }) => audience === 'public').map(({ slug }) => slug),
  )
  const sites = Map.groupBy(
    input.placed.filter(({ document }) => publicWorkspaces.has(document.workspace)),
    ({ collectionId }) => collectionId,
  )
  for (const [collectionId, entries] of sites) {
    const home = entries.find(({ document }) => document.revisions.length > 0)
    const result = await publishCollection(deps, {
      collectionId,
      /* v8 ignore next -- every public collection has something published (`content.test.ts`). */
      homeDocumentId: home?.id ?? null,
      publishedBy: input.admin,
    })
    /* v8 ignore next -- publishing is allowed by the settings written above. */
    if (result.kind !== 'published') throw new Error(`Demo site refused: ${result.kind}`)
  }
  return sites.size
}
