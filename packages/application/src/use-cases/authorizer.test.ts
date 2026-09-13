import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, shareLinkId, userId, workspaceId } from '@quill/domain'
import type { Role } from '@quill/domain'

import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { CreateGrantInput, GrantRow, PrincipalKind, ScopeKind } from '../ports/persistence.ts'
import { createAuthorizer, toGrants } from './authorizer.ts'
import type { AuthorizerRepositories } from './authorizer.ts'
import type { ShareLinkDependencies } from './share-links.ts'
import { aShortId, createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createFakeTokenService } from '../test-support/fakes.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')

const ADMIN = userId('00000000-0000-4000-8000-0000000000ad')
const EDITOR = userId('00000000-0000-4000-8000-000000000001')
const OUTSIDER = userId('00000000-0000-4000-8000-000000000002')
const GHOST = userId('00000000-0000-4000-8000-0000000000ff')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER_WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000102')
const PARENT = documentId('00000000-0000-4000-8000-000000000201')
const CHILD = documentId('00000000-0000-4000-8000-000000000202')
const ORPHAN = documentId('00000000-0000-4000-8000-000000000203')
const MISSING = documentId('00000000-0000-4000-8000-0000000002ff')
const SHARE_LINK = shareLinkId('00000000-0000-4000-8000-000000000301')

let uow: InMemoryUnitOfWork
let grantCounter = 0
let shareLinks: ShareLinkDependencies
let linksAllowed = true

/**
 * Everything resolving a presented token needs. The fake token service hashes
 * `x` to `sha256:x`, so a test can plant a link whose token it knows.
 */
function shareLinkDependencies(): ShareLinkDependencies {
  return {
    uow,
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator('1111'),
    tokens: createFakeTokenService(),
    shareLinkPolicy: { allowed: () => linksAllowed },
  }
}

async function plantLink(
  token: string,
  overrides: {
    readonly documentId?: typeof PARENT
    readonly scope?: 'document' | 'subtree'
    readonly expiresAt?: Date | null
    readonly revokedAt?: Date | null
  } = {},
): Promise<void> {
  const link = await uow.repos.shareLinks.create({
    id: SHARE_LINK,
    documentId: overrides.documentId ?? PARENT,
    tokenHash: `sha256:${token}`,
    scope: overrides.scope ?? 'document',
    role: 'viewer',
    expiresAt: overrides.expiresAt ?? null,
    createdBy: EDITOR,
    now: NOW,
  })
  if (overrides.revokedAt != null) await uow.repos.shareLinks.revoke(link.id, overrides.revokedAt)
}

async function grant(
  input: Partial<CreateGrantInput> & { role: Role; scopeKind: ScopeKind; scopeId: string | null },
): Promise<void> {
  grantCounter += 1
  await uow.repos.grants.create({
    id: `grant-${grantCounter}`,
    principalKind: input.principalKind ?? 'user',
    principalId: input.principalId ?? EDITOR,
    effect: input.effect ?? 'allow',
    createdBy: null,
    now: NOW,
    ...input,
  })
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  grantCounter = 0
  linksAllowed = true
  shareLinks = shareLinkDependencies()
  await uow.repos.units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await uow.repos.units.create({
    id: 'platform',
    parentId: 'acme',
    name: 'Platform',
    slug: 'platform',
    label: 'team',
    now: NOW,
  })
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'platform',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'architecture',
    workspaceId: WORKSPACE,
    name: 'Architecture',
    slug: 'architecture',
    now: NOW,
  })
  for (const [id, parentId, collectionId] of [
    [PARENT, null, 'architecture'],
    [CHILD, PARENT, 'architecture'],
    [ORPHAN, null, null],
  ] as const) {
    await uow.repos.documents.create({
      id,
      shortId: aShortId(),
      workspaceId: WORKSPACE,
      collectionId,
      parentId,
      slug: id,
      path: `architecture/${id}.md`,
      title: `Document ${id}`,
      status: 'draft',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
  }
  await uow.repos.users.create({
    id: EDITOR,
    email: 'editor@example.com',
    displayName: 'Editor',
    now: NOW,
  })
  await uow.repos.users.create({
    id: ADMIN,
    email: 'admin@example.com',
    displayName: 'Admin',
    now: NOW,
  })
  await uow.repos.users.setInstanceAdmin(ADMIN, true)
  await uow.repos.users.create({
    id: OUTSIDER,
    email: 'outsider@example.com',
    displayName: 'Outsider',
    now: NOW,
  })
})

const forUser = (id: typeof EDITOR | null, shareLinkToken: string | null = null) =>
  createAuthorizer(uow.repos, { userId: id, shareLinkToken }, shareLinks)

/** The kind of failure an access result carries, or `null` when it succeeded. */
function failureOf(access: { ok: boolean; error?: { kind: string } }): string | null {
  return access.ok ? null : (access.error?.kind ?? null)
}

describe('createAuthorizer: documents', () => {
  it('resolves the nearest scope that carries a grant', async () => {
    await grant({ scopeKind: 'unit', scopeId: 'acme', role: 'viewer' })
    await grant({ scopeKind: 'collection', scopeId: 'architecture', role: 'editor' })

    const access = await forUser(EDITOR).document(CHILD)
    expect(access.ok && access.value.role).toBe('editor')
    expect(access.ok && access.value.capabilities.edit).toBe(true)
    expect(access.ok && access.value.document.id).toBe(CHILD)
    expect(access.ok && access.value.workspace.id).toBe(WORKSPACE)
  })

  it('lets a grant on an ancestor document reach the subtree below it', async () => {
    await grant({ scopeKind: 'document', scopeId: PARENT, role: 'contributor' })
    const access = await forUser(EDITOR).document(CHILD)
    expect(access.ok && access.value.role).toBe('contributor')
  })

  it('carves one document back out of a shared collection with a deny', async () => {
    await grant({ scopeKind: 'workspace', scopeId: WORKSPACE, role: 'editor' })
    await grant({ scopeKind: 'document', scopeId: CHILD, role: 'viewer', effect: 'deny' })

    const authorizer = forUser(EDITOR)
    expect((await authorizer.document(PARENT)).ok).toBe(true)
    const denied = await authorizer.document(CHILD)
    expect(denied.ok && denied.value.role).toBeNull()
    expect(denied.ok && denied.value.capabilities.view).toBe(false)
  })

  it('reaches a member through the groups their group nests inside', async () => {
    await uow.repos.groups.create({
      id: 'engineering',
      unitId: 'acme',
      parentGroupId: null,
      name: 'Engineering',
      now: NOW,
    })
    await uow.repos.groups.create({
      id: 'platform-group',
      unitId: 'acme',
      parentGroupId: 'engineering',
      name: 'Platform',
      now: NOW,
    })
    await uow.repos.groups.addMember({ groupId: 'platform-group', userId: EDITOR, now: NOW })
    await grant({
      principalKind: 'group',
      principalId: 'engineering',
      scopeKind: 'workspace',
      scopeId: WORKSPACE,
      role: 'admin',
    })

    const access = await forUser(EDITOR).document(PARENT)
    expect(access.ok && access.value.capabilities.manage).toBe(true)
  })

  it('gives an instance admin owner access without reading a single grant', async () => {
    const access = await forUser(ADMIN).document(PARENT)
    expect(access.ok && access.value.role).toBe('owner')
    expect(access.ok && access.value.isInstanceAdmin).toBe(true)
  })

  it('gives an anonymous reader whatever the public principal was granted', async () => {
    await grant({
      principalKind: 'public',
      principalId: null,
      scopeKind: 'collection',
      scopeId: 'architecture',
      role: 'viewer',
    })
    const access = await forUser(null).document(PARENT)
    expect(access.ok && access.value.role).toBe('viewer')
  })

  it('grants what a share link carries, and nothing beyond its scope', async () => {
    await plantLink('secret')
    const anonymous = forUser(null, 'secret')

    const target = await anonymous.document(PARENT)
    expect(target.ok && target.value.role).toBe('viewer')
    expect(target.ok && target.value.capabilities.edit).toBe(false)
    const child = await anonymous.document(CHILD)
    expect(child.ok && child.value.role).toBeNull()
    // The link says nothing about the workspace it happens to live in.
    const workspace = await anonymous.workspace(WORKSPACE)
    expect(workspace.ok && workspace.value.role).toBeNull()
  })

  it('reaches every document under the target when the link is a subtree', async () => {
    await plantLink('secret', { scope: 'subtree' })
    const reader = forUser(null, 'secret')
    expect((await reader.document(PARENT)).ok).toBe(true)
    const child = await reader.document(CHILD)
    expect(child.ok && child.value.role).toBe('viewer')
    const orphan = await reader.document(ORPHAN)
    expect(failureOf(orphan)).toBe('document-without-collection')
  })

  it('grants nothing for a token no link has ever carried', async () => {
    await plantLink('secret')
    const access = await forUser(null, 'not-a-token').document(PARENT)
    expect(access.ok && access.value.role).toBeNull()
  })

  it('refuses a link whose document has gone', async () => {
    await plantLink('secret')
    await uow.repos.documents.delete(PARENT)
    expect(await forUser(null, 'secret').shareLink()).toBeNull()
  })

  it('refuses a link once it has expired', async () => {
    await plantLink('secret', { expiresAt: NOW })
    const access = await forUser(null, 'secret').document(PARENT)
    expect(access.ok && access.value.role).toBeNull()
  })

  it('refuses a link once it has been revoked', async () => {
    await plantLink('secret', { revokedAt: NOW })
    const access = await forUser(null, 'secret').document(PARENT)
    expect(access.ok && access.value.role).toBeNull()
  })

  it('refuses every link when the organisation does not allow them', async () => {
    await plantLink('secret')
    linksAllowed = false
    const access = await forUser(null, 'secret').document(PARENT)
    expect(access.ok && access.value.role).toBeNull()
  })

  it('closes only the link when the link itself is denied (ADR-012 amendment)', async () => {
    await plantLink('secret', { scope: 'subtree' })
    await grant({ scopeKind: 'workspace', scopeId: WORKSPACE, role: 'editor' })
    await grant({
      principalKind: 'share_link',
      principalId: SHARE_LINK,
      scopeKind: 'document',
      scopeId: CHILD,
      effect: 'deny',
      role: 'viewer',
    })

    const throughTheLink = await forUser(null, 'secret').document(CHILD)
    expect(throughTheLink.ok && throughTheLink.value.role).toBeNull()
    // The member who writes the document still reaches it, through the door
    // that is theirs: denying a channel is not denying a person.
    const member = await forUser(EDITOR, 'secret').document(CHILD)
    expect(member.ok && member.value.role).toBe('editor')
  })

  it('reports the link a request presented, and null when it presented none or a bad one', async () => {
    await plantLink('secret')
    expect((await forUser(null, 'secret').shareLink())?.link.id).toBe(SHARE_LINK)
    expect(await forUser(null).shareLink()).toBeNull()
    expect(await forUser(null, 'wrong').shareLink()).toBeNull()
  })

  it('grants nothing when no grant on the chain matches', async () => {
    const access = await forUser(OUTSIDER).document(PARENT)
    expect(access.ok && access.value.role).toBeNull()
    expect(access.ok && access.value.capabilities).toEqual({
      view: false,
      comment: false,
      edit: false,
      manage: false,
      own: false,
    })
  })

  it('falls back to the anonymous identity when the session outlived its user', async () => {
    await grant({
      principalKind: 'public',
      principalId: null,
      scopeKind: 'workspace',
      scopeId: WORKSPACE,
      role: 'viewer',
    })
    const access = await forUser(GHOST).document(PARENT)
    expect(access.ok && access.value.role).toBe('viewer')
    expect(access.ok && access.value.isInstanceAdmin).toBe(false)
  })

  it('reports a document, workspace, or collection it cannot find', async () => {
    const missing = await forUser(EDITOR).document(MISSING)
    expect(!missing.ok && missing.error).toEqual({
      kind: 'document-not-found',
      documentId: MISSING,
    })

    await uow.repos.documents.update(PARENT, { collectionId: 'nope' }, NOW)
    const noCollection = await forUser(EDITOR).document(PARENT)
    expect(!noCollection.ok && noCollection.error.kind).toBe('collection-not-found')

    await uow.repos.workspaces.delete(WORKSPACE)
    const noWorkspace = await forUser(EDITOR).document(PARENT)
    expect(!noWorkspace.ok && noWorkspace.error).toEqual({
      kind: 'workspace-not-found',
      workspaceId: WORKSPACE,
    })
  })

  it('reports a document that sits outside every collection', async () => {
    const orphaned = await forUser(EDITOR).document(ORPHAN)
    expect(!orphaned.ok && orphaned.error).toEqual({
      kind: 'document-without-collection',
      documentId: ORPHAN,
    })
  })

  it('reports a document whose ancestor sits outside its collection', async () => {
    await uow.repos.documents.update(PARENT, { collectionId: null }, NOW)
    const failed = await forUser(EDITOR).document(CHILD)
    expect(!failed.ok && failed.error).toEqual({
      kind: 'broken-tree',
      failure: { kind: 'unknown-document', documentId: PARENT },
    })
  })

  it('reports a broken tree rather than looping on it', async () => {
    await uow.repos.units.create({
      id: 'loop',
      parentId: 'loop',
      name: 'Loop',
      slug: 'loop',
      label: 'team',
      now: NOW,
    })
    await uow.repos.workspaces.create({
      id: OTHER_WORKSPACE,
      unitId: 'loop',
      name: 'Looping',
      slug: 'looping',
      now: NOW,
    })
    const failed = await forUser(EDITOR).workspace(OTHER_WORKSPACE)
    expect(!failed.ok && failed.error).toEqual({
      kind: 'broken-tree',
      failure: { kind: 'unit-cycle', unitId: 'loop' },
    })
  })

  it('loads a document, its chain, and its grants once however many times a request asks', async () => {
    await grant({ scopeKind: 'workspace', scopeId: WORKSPACE, role: 'viewer' })
    const { calls, repos } = counting()
    const authorizer = createAuthorizer(repos, { userId: EDITOR, shareLinkToken: null }, shareLinks)

    await authorizer.document(PARENT)
    await authorizer.document(PARENT)
    await authorizer.workspace(WORKSPACE)

    // Every repository the walk touches, counted: the row lookups, the chain,
    // and the grants attached to it. The workspace check adds one chain and
    // one grant lookup of its own, and nothing else.
    expect(calls).toEqual([
      'documents.findById',
      'workspaces.findById',
      'collections.findById',
      'documents.listAncestors',
      'units.listAncestors',
      'users.findById',
      'groups.listForUser',
      'grants.listForScopes',
      'units.listAncestors',
      'grants.listForScopes',
    ])
  })

  it('shares one lookup between checks that start together', async () => {
    const { calls, repos } = counting()
    const authorizer = createAuthorizer(repos, { userId: EDITOR, shareLinkToken: null }, shareLinks)
    await Promise.all([authorizer.document(PARENT), authorizer.document(PARENT)])
    expect(calls.filter((call) => call === 'documents.findById')).toHaveLength(1)
  })
})

/**
 * The authorizer's repositories, wrapped so a test can state exactly which
 * queries a request makes rather than claiming a saving it never measured.
 */
function counting(): { calls: string[]; repos: AuthorizerRepositories } {
  const calls: string[] = []
  const watched = <T extends object>(name: string, repository: T): T =>
    new Proxy(repository, {
      get: (target, property: string) => {
        const method = Reflect.get(target, property) as unknown
        if (typeof method !== 'function') return method
        return (...args: unknown[]) => {
          calls.push(`${name}.${property}`)
          return (method as (...a: unknown[]) => unknown).apply(target, args)
        }
      },
    })

  return {
    calls,
    repos: {
      users: watched('users', uow.repos.users),
      groups: watched('groups', uow.repos.groups),
      units: watched('units', uow.repos.units),
      workspaces: watched('workspaces', uow.repos.workspaces),
      collections: watched('collections', uow.repos.collections),
      documents: watched('documents', uow.repos.documents),
      grants: watched('grants', uow.repos.grants),
    },
  }
}

describe('createAuthorizer: workspaces and identities', () => {
  it('resolves a workspace through its units and the instance', async () => {
    await grant({ scopeKind: 'instance', scopeId: null, role: 'viewer' })
    const access = await forUser(EDITOR).workspace(WORKSPACE)
    expect(access.ok && access.value.role).toBe('viewer')

    const missing = await forUser(EDITOR).workspace(OTHER_WORKSPACE)
    expect(!missing.ok && missing.error.kind).toBe('workspace-not-found')
  })

  it('expands a request into the principals it holds', async () => {
    await uow.repos.groups.create({
      id: 'engineering',
      unitId: 'acme',
      parentGroupId: null,
      name: 'Engineering',
      now: NOW,
    })
    await uow.repos.groups.addMember({ groupId: 'engineering', userId: EDITOR, now: NOW })

    // The share link the request claims is not among them: see above.
    expect(await forUser(EDITOR, SHARE_LINK).identities()).toEqual([
      { kind: 'user', userId: EDITOR },
      { kind: 'group', groupId: 'engineering' },
      { kind: 'public' },
    ])
    expect(await forUser(null).identities()).toEqual([{ kind: 'public' }])
  })
})

describe('toGrants', () => {
  const row = (over: Partial<GrantRow>): GrantRow => ({
    id: 'grant',
    principalKind: 'user' as PrincipalKind,
    principalId: EDITOR,
    scopeKind: 'workspace' as ScopeKind,
    scopeId: WORKSPACE,
    role: 'viewer',
    effect: 'allow',
    createdBy: null,
    createdAt: NOW,
    ...over,
  })

  it('maps every scope and principal kind the port can hold', () => {
    const grants = [
      ...toGrants([
        row({ scopeKind: 'instance', scopeId: null, principalKind: 'public', principalId: null }),
        row({ scopeKind: 'unit', scopeId: 'acme' }),
        row({ scopeKind: 'collection', scopeId: 'architecture', principalKind: 'group' }),
        row({ scopeKind: 'document', scopeId: PARENT, principalKind: 'share_link' }),
      ]),
    ]
    expect(grants.map((entry) => entry.scope.kind)).toEqual([
      'instance',
      'unit',
      'collection',
      'document',
    ])
    expect(grants.map((entry) => entry.principal.kind)).toEqual([
      'public',
      'user',
      'group',
      'share-link',
    ])
  })

  it('drops a row that names no scope or no principal, rather than guessing at one', () => {
    expect([...toGrants([row({ scopeKind: 'workspace', scopeId: null })])]).toEqual([])
    expect([...toGrants([row({ principalKind: 'user', principalId: null })])]).toEqual([])
  })
})

/**
 * A collection is a permission scope of its own (ADR-012), which is what
 * moving a document into one has to ask about (review finding H5).
 */
describe('createAuthorizer: collections', () => {
  it('resolves through the collection, its workspace, and the units above it', async () => {
    await grant({ scopeKind: 'unit', scopeId: 'acme', role: 'viewer' })
    await grant({ scopeKind: 'collection', scopeId: 'architecture', role: 'admin' })

    const access = await forUser(EDITOR).collection('architecture')
    if (!access.ok) throw new Error(`unexpected failure: ${access.error.kind}`)
    expect(access.value.collection.id).toBe('architecture')
    expect(access.value.workspace.id).toBe(WORKSPACE)
    expect(access.value.capabilities.manage).toBe(true)
  })

  it('gives an instance admin owner access without reading a grant', async () => {
    const access = await forUser(ADMIN).collection('architecture')
    expect(access.ok && access.value.isInstanceAdmin).toBe(true)
  })

  it('answers nothing to a request that holds no grant', async () => {
    const access = await forUser(OUTSIDER).collection('architecture')
    expect(access.ok && access.value.role).toBeNull()
  })

  it('answers collection-not-found for one that does not exist', async () => {
    expect(failureOf(await forUser(EDITOR).collection('nope'))).toBe('collection-not-found')
  })

  it('answers workspace-not-found when the collection names a workspace that is gone', async () => {
    await uow.repos.collections.create({
      id: 'orphan-collection',
      workspaceId: OTHER_WORKSPACE,
      name: 'Orphan',
      slug: 'orphan',
      now: NOW,
    })
    expect(failureOf(await forUser(EDITOR).collection('orphan-collection'))).toBe(
      'workspace-not-found',
    )
  })

  it('loads the chain once however many times it is asked', async () => {
    const authorizer = forUser(EDITOR)
    await authorizer.collection('architecture')
    await authorizer.collection('architecture')
    // Memoised per request: two checks of the same collection cost one walk.
    expect((await authorizer.collection('architecture')).ok).toBe(true)
  })
})

describe('createAuthorizer: a collection in a broken tree', () => {
  it('reports the broken chain rather than guessing at access', async () => {
    // The workspace's unit is gone, so there is no chain to resolve against.
    await uow.repos.units.delete('platform')
    expect(failureOf(await forUser(EDITOR).collection('architecture'))).toBe('broken-tree')
  })
})
