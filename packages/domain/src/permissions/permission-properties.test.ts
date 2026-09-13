import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  collectionId,
  documentId,
  groupId,
  shareLinkId,
  unitId,
  userId,
  workspaceId,
} from '../ids.ts'
import { ROLES } from '../roles.ts'
import type { Collection } from '../tenancy/collection.ts'
import type { Document } from '../tenancy/document.ts'
import type { OrganisationalUnit } from '../tenancy/organisational-unit.ts'
import type { Workspace } from '../tenancy/workspace.ts'
import type { Capabilities } from './capabilities.ts'
import { NO_CAPABILITIES } from './capabilities.ts'
import { combineContributions } from './combine.ts'
import type { Grant } from './grant.ts'
import type { EffectivePermissionRow, WorkspaceTree } from './materialise.ts'
import { materialiseEffectivePermissions } from './materialise.ts'
import type { Principal } from './principal.ts'
import {
  PUBLIC_PRINCIPAL,
  groupPrincipal,
  principalKey,
  shareLinkPrincipal,
  userPrincipal,
} from './principal.ts'
import { resolvePermission } from './resolve.ts'
import type { ScopeChain } from './scope-chain.ts'
import { buildScopeChain } from './scope-chain.ts'
import type { Scope } from './scope.ts'
import {
  INSTANCE_SCOPE,
  collectionScope,
  documentScope,
  scopeKey,
  scopeSpecificity,
  unitScope,
  workspaceScope,
} from './scope.ts'

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

const ROOT = unitId(uuid(1))
const TEAM = unitId(uuid(2))
const WORKSPACE = workspaceId(uuid(3))
const COLLECTION_IDS = [collectionId(uuid(4)), collectionId(uuid(5))] as const
const DOCUMENT_IDS = [
  documentId(uuid(6)),
  documentId(uuid(7)),
  documentId(uuid(8)),
  documentId(uuid(9)),
] as const

const PRINCIPALS: readonly Principal[] = [
  userPrincipal(userId(uuid(10))),
  userPrincipal(userId(uuid(11))),
  groupPrincipal(groupId(uuid(12))),
  PUBLIC_PRINCIPAL,
  shareLinkPrincipal(shareLinkId(uuid(13))),
]

const SCOPES: readonly Scope[] = [
  INSTANCE_SCOPE,
  unitScope(ROOT),
  unitScope(TEAM),
  workspaceScope(WORKSPACE),
  ...COLLECTION_IDS.map(collectionScope),
  ...DOCUMENT_IDS.map(documentScope),
]

const CAPABILITY_KEYS = [
  'view',
  'comment',
  'edit',
  'manage',
  'own',
] as const satisfies readonly (keyof Capabilities)[]

const root: OrganisationalUnit = {
  id: ROOT,
  parentId: null,
  name: 'Acme',
  slug: 'acme',
  label: 'company',
}
const team: OrganisationalUnit = {
  id: TEAM,
  parentId: ROOT,
  name: 'Platform',
  slug: 'platform',
  label: 'team',
}
const unitsById = new Map([
  [ROOT, root],
  [TEAM, team],
])

const workspace: Workspace = { id: WORKSPACE, unitId: TEAM, name: 'Docs', slug: 'docs' }

const collections: readonly Collection[] = COLLECTION_IDS.map((id, index) => ({
  id,
  workspaceId: WORKSPACE,
  name: `Collection ${index}`,
  slug: `collection-${index}`,
}))

function makeDocument(
  index: number,
  collection: Collection,
  parentId: Document['parentId'] = null,
): Document {
  return {
    id: DOCUMENT_IDS[index]!,
    workspaceId: WORKSPACE,
    collectionId: collection.id,
    parentId,
    slug: `document-${index}`,
    title: `Document ${index}`,
    status: 'published',
  }
}

/**
 * `placement[i]` is the index of the collection document `i` belongs to.
 * `nesting[i]` picks document `i`'s parent from among the documents already
 * placed earlier in the same collection (or leaves it a root), which keeps
 * every generated tree acyclic and single-collection by construction.
 */
function buildTree(placement: readonly number[], nesting: readonly number[]): WorkspaceTree {
  return {
    workspace,
    unitsById,
    collections: collections.map((collection, collectionIndex) => {
      const documents: Document[] = []
      placement.forEach((target, documentIndex) => {
        if (target !== collectionIndex) return
        const slot = nesting[documentIndex]! % (documents.length + 1)
        const parent = slot === documents.length ? null : documents[slot]!
        documents.push(makeDocument(documentIndex, collection, parent?.id ?? null))
      })
      return { collection, documents }
    }),
  }
}

function documentsById(tree: WorkspaceTree): ReadonlyMap<Document['id'], Document> {
  const byId = new Map<Document['id'], Document>()
  for (const { documents } of tree.collections) {
    for (const document of documents) byId.set(document.id, document)
  }
  return byId
}

function chainOf(
  document: Document,
  collection: Collection,
  byId: ReadonlyMap<Document['id'], Document>,
): ScopeChain {
  const chain = buildScopeChain({ document, collection, workspace, unitsById, documentsById: byId })
  if (!chain.ok) throw new Error(`fixture chain must build: ${chain.error.kind}`)
  return chain.value
}

/** Where a scope sits counted from the instance, the way a row records it. */
function depthOf(chain: ScopeChain, scope: Scope): number {
  return chain.length - 1 - chain.findIndex((candidate) => scopeKey(candidate) === scopeKey(scope))
}

/**
 * The oracle: every row, resolved one document and one principal at a time.
 *
 * With a single principal the resolver returns exactly that principal's
 * contribution, deny included, which is what a materialised row is.
 */
function resolveEveryRow(
  tree: WorkspaceTree,
  grants: readonly Grant[],
): readonly EffectivePermissionRow[] {
  const byId = documentsById(tree)

  return tree.collections.flatMap(({ collection, documents }) =>
    documents.flatMap((document) => {
      const chain = chainOf(document, collection, byId)

      return PRINCIPALS.flatMap((principal) => {
        const { by, decidedAt } = resolvePermission({ chain, identities: [principal], grants })
        if (by === null || decidedAt === null) return []
        return [
          {
            documentId: document.id,
            principal,
            role: by.role,
            effect: by.effect,
            depth: depthOf(chain, decidedAt),
            scope: decidedAt,
          },
        ]
      })
    }),
  )
}

function sortRows(rows: readonly EffectivePermissionRow[]): readonly EffectivePermissionRow[] {
  return rows.toSorted((a, b) => {
    const byDocument = a.documentId.localeCompare(b.documentId)
    if (byDocument !== 0) return byDocument
    return principalKey(a.principal).localeCompare(principalKey(b.principal))
  })
}

const FIRST_DOCUMENT = makeDocument(0, collections[0]!)
const FIRST_CHAIN = buildScopeChain({
  document: FIRST_DOCUMENT,
  collection: collections[0]!,
  workspace,
  unitsById,
  documentsById: new Map([[FIRST_DOCUMENT.id, FIRST_DOCUMENT]]),
})
if (!FIRST_CHAIN.ok) throw new Error('fixture chain must build')
const CHAIN = FIRST_CHAIN.value

const principalArb = fc.constantFrom(...PRINCIPALS)
const roleArb = fc.constantFrom(...ROLES)
const scopeArb = fc.constantFrom(...SCOPES)

const grantArb: fc.Arbitrary<Grant> = fc.record({
  principal: principalArb,
  scope: scopeArb,
  role: roleArb,
  effect: fc.constantFrom<Grant['effect']>('allow', 'deny'),
})

const allowArb: fc.Arbitrary<Grant> = fc.record({
  principal: principalArb,
  scope: scopeArb,
  role: roleArb,
  effect: fc.constant<Grant['effect']>('allow'),
})

const grantsArb = fc.array(grantArb, { maxLength: 12 })
const identitiesArb = fc.subarray([...PRINCIPALS], { minLength: 1 })

/** People, whose denies withdraw a document outright. */
const PEOPLE = PRINCIPALS.filter(
  (principal) => principal.kind === 'user' || principal.kind === 'group',
)

/** Channels, whose denies close only themselves. */
const CHANNELS = PRINCIPALS.filter(
  (principal) => principal.kind === 'public' || principal.kind === 'share-link',
)

/**
 * Grants whose allows and denies never sit on the same principal.
 *
 * One of `candidates` is nominated to carry any deny and every other grant is
 * forced to an allow, so a generated case routinely looks like a group allowed
 * at a collection and a user denied at a document — the shape that separates
 * per-principal resolution from the whole-identity-set rule it replaced.
 */
function grantsDeniedBy(candidates: readonly Principal[]): fc.Arbitrary<readonly Grant[]> {
  return fc.tuple(fc.constantFrom(...candidates), grantsArb).map(([denied, grants]) =>
    grants.map((grant): Grant => ({
      ...grant,
      effect: principalKey(grant.principal) === principalKey(denied) ? grant.effect : 'allow',
    })),
  )
}

/** Both halves of the deny rule: a deny on a person, and a deny on a channel. */
const splitGrantsArb: fc.Arbitrary<readonly Grant[]> = fc.oneof(
  grantsDeniedBy(PEOPLE),
  grantsDeniedBy(CHANNELS),
)

/** A request always holds the public principal, whoever else it is. */
const identitySetArb: fc.Arbitrary<readonly Principal[]> = identitiesArb.map((chosen) =>
  chosen.includes(PUBLIC_PRINCIPAL) ? chosen : [...chosen, PUBLIC_PRINCIPAL],
)

/** Where a scope sits on the chain, or -1 when it is not on it at all. */
function chainPosition(scope: Scope): number {
  return CHAIN.findIndex((candidate) => scopeKey(candidate) === scopeKey(scope))
}

describe('resolvePermission properties', () => {
  it('never loses a capability when an allow is added no nearer than the deciding scope', () => {
    fc.assert(
      fc.property(grantsArb, allowArb, identitiesArb, (grants, extra, identities) => {
        const before = resolvePermission({ chain: CHAIN, identities, grants })

        // A nearer allow is meant to replace what a broader scope said, so it
        // may legitimately lower the role; everything else may only add.
        // Nearness is position on the chain, not scope kind: a chain holds one
        // scope per ancestor unit and they all share the same kind.
        fc.pre(
          before.decidedAt === null ||
            chainPosition(extra.scope) === -1 ||
            chainPosition(extra.scope) >= chainPosition(before.decidedAt),
        )

        const after = resolvePermission({ chain: CHAIN, identities, grants: [...grants, extra] })
        const lost = CAPABILITY_KEYS.filter(
          (key) => before.capabilities[key] && !after.capabilities[key],
        )
        expect(lost).toEqual([])
      }),
      { numRuns: 500 },
    )
  })

  it('lets a nearer unit scope lower what an ancestor unit granted', () => {
    const principal = PRINCIPALS[0]!
    const permission = resolvePermission({
      chain: CHAIN,
      identities: [principal],
      grants: [
        { principal, scope: unitScope(ROOT), role: 'owner', effect: 'allow' },
        { principal, scope: unitScope(TEAM), role: 'viewer', effect: 'allow' },
      ],
    })

    expect(permission.decidedAt).toEqual(unitScope(TEAM))
    expect(permission.role).toBe('viewer')
    expect(scopeSpecificity(unitScope(TEAM))).toBe(scopeSpecificity(unitScope(ROOT)))
  })

  it('withdraws all access when a person the request holds is denied at document scope', () => {
    fc.assert(
      fc.property(
        grantsArb,
        identitiesArb,
        roleArb,
        fc.constantFrom(...PEOPLE),
        (grants, identities, role, person) => {
          const denial: Grant = {
            principal: person,
            scope: documentScope(FIRST_DOCUMENT.id),
            role,
            effect: 'deny',
          }

          const after = resolvePermission({
            chain: CHAIN,
            identities: [...identities, person],
            grants: [...grants, denial],
          })

          expect(after.role).toBeNull()
          expect(after.capabilities).toEqual(NO_CAPABILITIES)
          expect(after.decidedAt).toEqual(documentScope(FIRST_DOCUMENT.id))
        },
      ),
    )
  })

  it('keeps what a person was granted when the channel beside them is denied', () => {
    fc.assert(
      fc.property(
        allowArb,
        roleArb,
        fc.constantFrom(...PEOPLE),
        fc.constantFrom(...CHANNELS),
        (extra, role, person, channel) => {
          const granted: Grant = {
            principal: person,
            scope: workspaceScope(WORKSPACE),
            role,
            effect: 'allow',
          }
          const closed: Grant = {
            principal: channel,
            scope: documentScope(FIRST_DOCUMENT.id),
            role: 'viewer',
            effect: 'deny',
          }
          // Anything else generated is an allow, so only the closed channel is
          // in a position to take access away — and it must not.
          const identities = [person, channel, extra.principal]

          const after = resolvePermission({
            chain: CHAIN,
            identities,
            grants: [granted, closed, extra],
          })

          expect(after.role).not.toBeNull()
          expect(after.capabilities.view).toBe(true)
        },
      ),
    )
  })

  it('lets the nearer of two scopes on the chain decide', () => {
    const indexArb = fc.nat({ max: CHAIN.length - 1 })

    fc.assert(
      fc.property(
        principalArb,
        roleArb,
        roleArb,
        indexArb,
        indexArb,
        (principal, nearRole, farRole, a, b) => {
          fc.pre(a !== b)
          const nearer = CHAIN[Math.min(a, b)]!
          const further = CHAIN[Math.max(a, b)]!

          const permission = resolvePermission({
            chain: CHAIN,
            identities: [principal],
            grants: [
              { principal, scope: further, role: farRole, effect: 'allow' },
              { principal, scope: nearer, role: nearRole, effect: 'allow' },
            ],
          })

          expect(permission.decidedAt).toEqual(nearer)
          expect(permission.role).toBe(nearRole)
        },
      ),
    )
  })
})

describe('materialiseEffectivePermissions properties', () => {
  const placementArb = fc.array(fc.nat({ max: COLLECTION_IDS.length - 1 }), {
    minLength: DOCUMENT_IDS.length,
    maxLength: DOCUMENT_IDS.length,
  })
  const nestingArb = fc.array(fc.nat({ max: DOCUMENT_IDS.length }), {
    minLength: DOCUMENT_IDS.length,
    maxLength: DOCUMENT_IDS.length,
  })

  it('agrees with resolvePermission for every document and principal', () => {
    fc.assert(
      fc.property(placementArb, nestingArb, grantsArb, (placement, nesting, grants) => {
        const tree = buildTree(placement, nesting)
        const result = materialiseEffectivePermissions({ tree, grants })

        expect(result.ok ? sortRows(result.value) : result.error).toEqual(
          sortRows(resolveEveryRow(tree, grants)),
        )
      }),
      { numRuns: 500 },
    )
  })

  it('combines to what resolvePermission answers for every document and identity set', () => {
    fc.assert(
      fc.property(
        placementArb,
        nestingArb,
        fc.oneof(grantsArb, splitGrantsArb),
        identitySetArb,
        (placement, nesting, grants, identities) => {
          const tree = buildTree(placement, nesting)
          const materialised = materialiseEffectivePermissions({ tree, grants })
          if (!materialised.ok)
            throw new Error(`fixture tree must materialise: ${materialised.error.kind}`)

          const held = new Set(identities.map(principalKey))
          const byDocument = Map.groupBy(
            materialised.value.filter((row) => held.has(principalKey(row.principal))),
            (row) => row.documentId,
          )
          const byId = documentsById(tree)

          for (const { collection, documents } of tree.collections) {
            for (const document of documents) {
              const direct = resolvePermission({
                chain: chainOf(document, collection, byId),
                identities,
                grants,
              })
              const combined = combineContributions(byDocument.get(document.id) ?? [])

              expect(combined.role).toBe(direct.role)
              expect(combined.decidedBy?.scope ?? null).toEqual(direct.decidedAt)
            }
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('produces the same rows in the same order every time', () => {
    fc.assert(
      fc.property(placementArb, nestingArb, grantsArb, (placement, nesting, grants) => {
        const tree = buildTree(placement, nesting)
        expect(materialiseEffectivePermissions({ tree, grants })).toEqual(
          materialiseEffectivePermissions({ tree, grants }),
        )
      }),
    )
  })
})

describe('document ancestor grants', () => {
  const ROOT_DOCUMENT = documentId(uuid(14))
  const MID_DOCUMENT = documentId(uuid(15))
  const LEAF_DOCUMENT = documentId(uuid(16))
  const collection = collections[0]!

  const rootDocument: Document = {
    id: ROOT_DOCUMENT,
    workspaceId: WORKSPACE,
    collectionId: collection.id,
    parentId: null,
    slug: 'root',
    title: 'Root',
    status: 'published',
  }
  const midDocument: Document = {
    ...rootDocument,
    id: MID_DOCUMENT,
    parentId: ROOT_DOCUMENT,
    slug: 'mid',
  }
  const leafDocument: Document = {
    ...rootDocument,
    id: LEAF_DOCUMENT,
    parentId: MID_DOCUMENT,
    slug: 'leaf',
  }
  const documentTree = new Map([
    [ROOT_DOCUMENT, rootDocument],
    [MID_DOCUMENT, midDocument],
    [LEAF_DOCUMENT, leafDocument],
  ])

  function chainFor(document: Document): ScopeChain {
    const chain = buildScopeChain({
      document,
      collection,
      workspace,
      unitsById,
      documentsById: documentTree,
    })
    if (!chain.ok) throw new Error(`fixture chain must build: ${chain.error.kind}`)
    return chain.value
  }

  const rootChain = chainFor(rootDocument)
  const midChain = chainFor(midDocument)
  const leafChain = chainFor(leafDocument)

  it('reaches every descendant document unless a nearer grant decides', () => {
    fc.assert(
      fc.property(principalArb, roleArb, (principal, role) => {
        const grant: Grant = {
          principal,
          scope: documentScope(ROOT_DOCUMENT),
          role,
          effect: 'allow',
        }

        for (const chain of [rootChain, midChain, leafChain]) {
          const permission = resolvePermission({ chain, identities: [principal], grants: [grant] })
          expect(permission.role).toBe(role)
          expect(permission.decidedAt).toEqual(documentScope(ROOT_DOCUMENT))
        }
      }),
    )
  })

  it('lets a grant on a nearer ancestor override a farther one', () => {
    fc.assert(
      fc.property(principalArb, roleArb, roleArb, (principal, rootRole, midRole) => {
        const grants: Grant[] = [
          { principal, scope: documentScope(ROOT_DOCUMENT), role: rootRole, effect: 'allow' },
          { principal, scope: documentScope(MID_DOCUMENT), role: midRole, effect: 'allow' },
        ]

        const permission = resolvePermission({ chain: leafChain, identities: [principal], grants })
        expect(permission.role).toBe(midRole)
        expect(permission.decidedAt).toEqual(documentScope(MID_DOCUMENT))
      }),
    )
  })
})
