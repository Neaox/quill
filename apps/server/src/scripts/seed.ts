import {
  createDocument,
  createGrant,
  documentUrl,
  namedSlug,
  publishDocument,
  renderDocument,
} from '@quill/application'
import type { CollectionId, DocumentId, UserId, WorkspaceId } from '@quill/domain'
import type { UnitId } from '@quill/application'
import { parseDocument } from '@quill/markdown'

import type { AppDependencies } from '../dependencies.ts'
import {
  SEED_COLLECTIONS,
  SEED_DOCUMENTS,
  SEED_LINKS,
  SECOND_WORKSPACE_COLLECTIONS,
  SECOND_WORKSPACE_DOCUMENTS,
} from './seed-documents.ts'
import type { SeedDocument } from './seed-documents.ts'

/**
 * A local instance with something real in it.
 *
 * Everything goes through the use cases the API uses: documents are created,
 * their drafts written, and then published, so the revisions index, the render
 * cache, and the link index are populated exactly as they would be by a person
 * doing the same work. Running it twice changes nothing.
 */

export const ADMIN_EMAIL = 'admin@example.com'
export const ADMIN_PASSWORD = 'admin-password-change-me'
const ADMIN_NAME = 'Instance administrator'

/** A second account, an editor rather than an instance admin (ADR-012). */
export const WRITER_EMAIL = 'writer@example.com'
export const WRITER_PASSWORD = 'writer-password-change-me'
const WRITER_NAME = 'Ada Writer'

/** The seed holds no editor session; this names it in the one place a publish asks (ADR-021). */
const SEED_SESSION = 'seed'
const UNIT_NAME = 'Acme'
const WORKSPACE_NAME = 'Engineering'
const WORKSPACE_SLUG = 'engineering'

/** A second unit and workspace, so the organisational tree has real depth. */
const SECOND_UNIT_NAME = 'Platform'
const SECOND_WORKSPACE_NAME = 'Platform docs'
const SECOND_WORKSPACE_SLUG = 'platform-docs'

export interface SeedResult {
  readonly adminEmail: string
  readonly adminPassword: string
  readonly writerEmail: string
  readonly writerPassword: string
  readonly workspaceId: WorkspaceId
  readonly secondWorkspaceId: WorkspaceId
  readonly created: readonly string[]
  readonly unchanged: readonly string[]
}

export async function seedDevelopmentData(deps: AppDependencies): Promise<SeedResult> {
  const admin = await ensureUser(deps, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    displayName: ADMIN_NAME,
    isInstanceAdmin: true,
  })
  const writer = await ensureUser(deps, {
    email: WRITER_EMAIL,
    password: WRITER_PASSWORD,
    displayName: WRITER_NAME,
    isInstanceAdmin: false,
  })

  const acme = await ensureUnit(deps, { name: UNIT_NAME, label: 'company', parentId: null })
  const workspace = await ensureWorkspace(deps, {
    name: WORKSPACE_NAME,
    slug: WORKSPACE_SLUG,
    unitId: acme,
  })
  await ensureEditorGrant(deps, { admin, userId: writer, workspaceId: workspace })

  const platform = await ensureUnit(deps, {
    name: SECOND_UNIT_NAME,
    label: 'division',
    parentId: acme,
  })
  const secondWorkspace = await ensureWorkspace(deps, {
    name: SECOND_WORKSPACE_NAME,
    slug: SECOND_WORKSPACE_SLUG,
    unitId: platform,
  })

  const first = await seedDocuments(deps, {
    workspace,
    admin,
    collectionNames: SEED_COLLECTIONS,
    documents: SEED_DOCUMENTS,
  })
  const second = await seedDocuments(deps, {
    workspace: secondWorkspace,
    admin,
    collectionNames: SECOND_WORKSPACE_COLLECTIONS,
    documents: SECOND_WORKSPACE_DOCUMENTS,
  })

  return {
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
    writerEmail: WRITER_EMAIL,
    writerPassword: WRITER_PASSWORD,
    workspaceId: workspace,
    secondWorkspaceId: secondWorkspace,
    created: [...first.created, ...second.created],
    unchanged: [...first.unchanged, ...second.unchanged],
  }
}

interface EnsureUserInput {
  readonly email: string
  readonly password: string
  readonly displayName: string
  readonly isInstanceAdmin: boolean
}

async function ensureUser(deps: AppDependencies, input: EnsureUserInput): Promise<UserId> {
  const existing = await deps.uow.repos.users.findByEmail(input.email)
  const now = deps.clock.now()
  const user =
    existing ??
    (await deps.uow.repos.users.create({
      id: deps.ids.uuid() as UserId,
      email: input.email,
      displayName: input.displayName,
      now,
    }))

  await deps.uow.repos.users.setInstanceAdmin(user.id, input.isInstanceAdmin)
  await deps.uow.repos.users.markEmailVerified(user.id, now)
  await deps.uow.repos.credentials.upsert({
    userId: user.id,
    passwordHash: await deps.passwords.hash(input.password),
    now,
  })
  return user.id
}

interface EnsureUnitInput {
  readonly name: string
  readonly label: string
  readonly parentId: UnitId | null
}

async function ensureUnit(deps: AppDependencies, input: EnsureUnitInput): Promise<UnitId> {
  const siblings = await deps.uow.repos.units.listChildren(input.parentId)
  const existing = siblings.find((candidate) => candidate.name === input.name)
  if (existing !== undefined) return existing.id

  const unit = await deps.uow.repos.units.create({
    id: deps.ids.uuid(),
    parentId: input.parentId,
    name: input.name,
    slug: namedSlug(input.name),
    label: input.label,
    now: deps.clock.now(),
  })
  return unit.id
}

interface EnsureWorkspaceInput {
  readonly name: string
  readonly slug: string
  readonly unitId: UnitId
}

async function ensureWorkspace(
  deps: AppDependencies,
  input: EnsureWorkspaceInput,
): Promise<WorkspaceId> {
  const existing = await deps.uow.repos.workspaces.findBySlug(input.slug)
  if (existing !== null) return existing.id

  const workspace = await deps.uow.repos.workspaces.create({
    id: deps.ids.uuid() as WorkspaceId,
    unitId: input.unitId,
    name: input.name,
    slug: input.slug,
    now: deps.clock.now(),
  })
  return workspace.id
}

interface EnsureEditorGrantInput {
  readonly admin: UserId
  readonly userId: UserId
  readonly workspaceId: WorkspaceId
}

/**
 * Grants the writer editor on a workspace, through the same command a route
 * would use (ADR-012). Checked against the workspace's existing grants first,
 * so running the seed again does not stack up duplicate rows.
 */
async function ensureEditorGrant(
  deps: AppDependencies,
  input: EnsureEditorGrantInput,
): Promise<void> {
  const existing = await deps.uow.repos.grants.listForScope('workspace', input.workspaceId)
  const already = existing.some(
    (grant) =>
      grant.principalKind === 'user' &&
      grant.principalId === input.userId &&
      grant.role === 'editor' &&
      grant.effect === 'allow',
  )
  if (already) return

  const result = await createGrant(deps, {
    principalKind: 'user',
    principalId: input.userId,
    scopeKind: 'workspace',
    scopeId: input.workspaceId,
    role: 'editor',
    effect: 'allow',
    createdBy: input.admin,
  })
  /* v8 ignore next -- the writer and workspace are both known good here. */
  if (result.kind !== 'created') throw new Error(`Seed grant failed: ${result.kind}`)
}

async function ensureCollections(
  deps: AppDependencies,
  workspace: WorkspaceId,
  names: readonly string[],
): Promise<ReadonlyMap<string, CollectionId>> {
  const collections = new Map<string, CollectionId>()
  for (const name of names) {
    const slug = namedSlug(name)
    const existing = await deps.uow.repos.collections.findBySlug(workspace, slug)
    const collection =
      existing ??
      (await deps.uow.repos.collections.create({
        id: deps.ids.uuid() as CollectionId,
        workspaceId: workspace,
        name,
        slug,
        now: deps.clock.now(),
      }))
    collections.set(name, collection.id as CollectionId)
  }
  return collections
}

interface SeedDocumentsInput {
  readonly workspace: WorkspaceId
  readonly admin: UserId
  readonly collectionNames: readonly string[]
  readonly documents: readonly SeedDocument[]
}

interface SeedBatchResult {
  readonly created: readonly string[]
  readonly unchanged: readonly string[]
}

/**
 * Creates and publishes one workspace's worth of seed documents, reusing
 * whatever is already there (ADR-015: publish is the only write, so an
 * unpublished draft never blocks a second run from finding its document by
 * path). A document marked `published: false` is created and left as a draft.
 */
async function seedDocuments(
  deps: AppDependencies,
  input: SeedDocumentsInput,
): Promise<SeedBatchResult> {
  const collections = await ensureCollections(deps, input.workspace, input.collectionNames)

  const created: string[] = []
  const unchanged: string[] = []
  const byTitle = new Map<string, DocumentId>()

  for (const seed of input.documents) {
    const collectionId = collections.get(seed.collection)
    /* v8 ignore next -- every document's collection is created just above. */
    if (collectionId === undefined) continue

    const existing = await deps.uow.repos.documents.findByPath(
      input.workspace,
      `${namedSlug(seed.collection)}/${namedSlug(seed.title)}.md`,
    )
    if (existing !== null) {
      byTitle.set(seed.title, existing.id)
      unchanged.push(seed.title)
      continue
    }

    const document = await createDocument(deps, {
      workspaceId: input.workspace,
      collectionId,
      parentId: null,
      title: seed.title,
      createdBy: input.admin,
    })
    /* v8 ignore next -- the collection and the title are both known good here. */
    if (document.kind !== 'created') throw new Error(`Seed failed: ${document.kind}`)
    byTitle.set(seed.title, document.document.id)
    created.push(seed.title)
  }

  for (const seed of input.documents) {
    const id = byTitle.get(seed.title)
    if (id === undefined || !created.includes(seed.title)) continue

    const target = {
      id,
      admin: input.admin,
      workspace: input.workspace,
      markdown: seed.markdown,
      byTitle,
    }
    if (seed.published === false) await writeDraft(deps, target)
    else await writeAndPublish(deps, target)
  }

  return { created, unchanged }
}

interface WriteSeed {
  readonly id: DocumentId
  readonly workspace: WorkspaceId
  readonly markdown: string
  readonly byTitle: ReadonlyMap<string, DocumentId>
}

/** Writes the seed's Markdown into the document's draft, exactly as the editor does. */
async function writeDraft(deps: AppDependencies, seed: WriteSeed): Promise<void> {
  const { frontMatter, ast } = parseDocument(withDocumentLinks(seed.markdown, seed.byTitle))
  await deps.uow.repos.drafts.init({
    documentId: seed.id,
    baseRevision: await deps.contentStore.head(seed.workspace),
    ast: { version: 1, frontMatter: { ...frontMatter, id: seed.id }, ast },
    now: deps.clock.now(),
  })
}

interface PublishSeed extends WriteSeed {
  readonly admin: UserId
}

/**
 * Writes the draft and publishes it through the same use case the API calls
 * — so the revisions index, the render cache, and the link index end up in
 * the state a real publish leaves them in.
 */
async function writeAndPublish(deps: AppDependencies, seed: PublishSeed): Promise<void> {
  await writeDraft(deps, seed)

  const published = await publishDocument(deps, {
    documentId: seed.id,
    base: await deps.contentStore.head(seed.workspace),
    author: { userId: seed.admin, name: ADMIN_NAME, email: ADMIN_EMAIL },
    // The seed holds no editor session and nothing holds a lock on a document
    // it has just created, so this names the seed itself (ADR-021).
    sessionId: SEED_SESSION,
    changeNote: 'Seeded for local development',
  })
  /* v8 ignore next -- the seed publishes at the head it just read. */
  if (published.kind !== 'published') throw new Error(`Seed publish failed: ${published.kind}`)

  // In a running server this is the render-on-publish consumer's job; the
  // seed does it inline so a fresh instance reads without a first-render cost.
  await renderDocument(deps, { documentId: seed.id, revision: published.revision })
}

/**
 * Turns the titles a seed document links to into canonical id URLs (ADR-031).
 *
 * A title with no document behind it is simply not linked: the seed produces a
 * shorter "Related" list rather than a broken link.
 */
export function withDocumentLinks(
  markdown: string,
  byTitle: ReadonlyMap<string, DocumentId>,
): string {
  const references = (SEED_LINKS[titleOf(markdown)] ?? []).flatMap((title) => {
    const target = byTitle.get(title)
    return target === undefined ? [] : [`- [${title}](${documentUrl(target)})`]
  })
  return references.length === 0
    ? markdown
    : `${markdown}\n## Related\n\n${references.join('\n')}\n`
}

function titleOf(markdown: string): string {
  const { frontMatter } = parseDocument(markdown)
  const title = frontMatter['title']
  /* v8 ignore next -- every seed document declares its title in front matter. */
  return typeof title === 'string' ? title : ''
}
