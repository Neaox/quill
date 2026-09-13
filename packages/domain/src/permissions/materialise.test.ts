import { describe, expect, it } from 'vitest'

import { collectionId, documentId, groupId, unitId, userId, workspaceId } from '../ids.ts'
import type { Collection } from '../tenancy/collection.ts'
import type { Document } from '../tenancy/document.ts'
import type { OrganisationalUnit } from '../tenancy/organisational-unit.ts'
import type { Workspace } from '../tenancy/workspace.ts'
import type { Grant } from './grant.ts'
import type { EffectivePermissionRow, WorkspaceTree } from './materialise.ts'
import { materialiseEffectivePermissions } from './materialise.ts'
import { PUBLIC_PRINCIPAL, groupPrincipal, userPrincipal } from './principal.ts'
import {
  INSTANCE_SCOPE,
  collectionScope,
  documentScope,
  unitScope,
  workspaceScope,
} from './scope.ts'

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

const ROOT = unitId(uuid(1))
const TEAM = unitId(uuid(2))
const MISSING = unitId(uuid(3))
const WORKSPACE = workspaceId(uuid(4))
const OTHER_WORKSPACE = workspaceId(uuid(5))
const GUIDES = collectionId(uuid(6))
const OTHER_COLLECTION = collectionId(uuid(7))
const INTRO = documentId(uuid(8))
const SECRET = documentId(uuid(9))
const CHILD = documentId(uuid(13))
const GRANDCHILD = documentId(uuid(14))
const UNKNOWN_PARENT = documentId(uuid(15))
const FOREIGN_ANCESTOR = documentId(uuid(16))

const ALICE = userPrincipal(userId(uuid(10)))
const BOB = userPrincipal(userId(uuid(11)))
const PLATFORM = groupPrincipal(groupId(uuid(12)))

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
const guides: Collection = {
  id: GUIDES,
  workspaceId: WORKSPACE,
  name: 'Guides',
  slug: 'guides',
}

function doc(id: Document['id'], overrides: Partial<Document> = {}): Document {
  return {
    id,
    workspaceId: WORKSPACE,
    collectionId: GUIDES,
    parentId: null,
    slug: `slug-${id.slice(-1)}`,
    title: 'Doc',
    status: 'published',
    ...overrides,
  }
}

const tree: WorkspaceTree = {
  workspace,
  unitsById,
  collections: [{ collection: guides, documents: [doc(INTRO), doc(SECRET)] }],
}

/** INTRO is the root, CHILD nests under it, and GRANDCHILD nests under CHILD. */
const nestedTree: WorkspaceTree = {
  workspace,
  unitsById,
  collections: [
    {
      collection: guides,
      documents: [
        doc(INTRO),
        doc(CHILD, { parentId: INTRO }),
        doc(GRANDCHILD, { parentId: CHILD }),
      ],
    },
  ],
}

function allow(principal: Grant['principal'], scope: Grant['scope'], role: Grant['role']): Grant {
  return { principal, scope, role, effect: 'allow' }
}

function deny(principal: Grant['principal'], scope: Grant['scope']): Grant {
  return { principal, scope, role: 'viewer', effect: 'deny' }
}

function contributions(
  grants: readonly Grant[],
  from: WorkspaceTree = tree,
): readonly EffectivePermissionRow[] {
  const result = materialiseEffectivePermissions({ tree: from, grants })
  if (!result.ok) throw new Error(`unexpected failure: ${result.error.kind}`)
  return result.value
}

/** Rows without the depth and scope that only `combineContributions` reads. */
function rowsFor(grants: readonly Grant[], from: WorkspaceTree = tree) {
  return contributions(grants, from).map((row) => ({
    documentId: row.documentId,
    principal: row.principal,
    role: row.role,
    effect: row.effect,
  }))
}

describe('materialiseEffectivePermissions', () => {
  it('produces nothing when there are no grants', () => {
    expect(rowsFor([])).toEqual([])
  })

  it('spreads an instance grant to every document', () => {
    expect(rowsFor([allow(ALICE, INSTANCE_SCOPE, 'viewer')])).toEqual([
      { documentId: INTRO, principal: ALICE, role: 'viewer', effect: 'allow' },
      { documentId: SECRET, principal: ALICE, role: 'viewer', effect: 'allow' },
    ])
  })

  it('lets a nearer scope replace a further one', () => {
    const rows = rowsFor([
      allow(ALICE, unitScope(ROOT), 'owner'),
      allow(ALICE, unitScope(TEAM), 'admin'),
      allow(ALICE, workspaceScope(WORKSPACE), 'editor'),
      allow(ALICE, collectionScope(GUIDES), 'contributor'),
      allow(ALICE, documentScope(SECRET), 'viewer'),
    ])

    expect(rows).toEqual([
      { documentId: INTRO, principal: ALICE, role: 'contributor', effect: 'allow' },
      { documentId: SECRET, principal: ALICE, role: 'viewer', effect: 'allow' },
    ])
  })

  it('records the scope and depth that decided each row', () => {
    const rows = contributions([
      allow(ALICE, workspaceScope(WORKSPACE), 'editor'),
      deny(ALICE, documentScope(SECRET)),
    ])

    // Instance 0, the two units 1 and 2, the workspace 3, the collection 4,
    // and a root document 5: deeper is nearer.
    expect(rows).toEqual([
      {
        documentId: INTRO,
        principal: ALICE,
        role: 'editor',
        effect: 'allow',
        depth: 3,
        scope: workspaceScope(WORKSPACE),
      },
      {
        documentId: SECRET,
        principal: ALICE,
        role: 'viewer',
        effect: 'deny',
        depth: 5,
        scope: documentScope(SECRET),
      },
    ])
  })

  it('emits the deny that carves a document out of a wider grant', () => {
    const rows = rowsFor([
      allow(ALICE, workspaceScope(WORKSPACE), 'editor'),
      deny(ALICE, documentScope(SECRET)),
    ])

    expect(rows).toEqual([
      { documentId: INTRO, principal: ALICE, role: 'editor', effect: 'allow' },
      { documentId: SECRET, principal: ALICE, role: 'viewer', effect: 'deny' },
    ])
  })

  it('keeps a deny at a scope once it is set, whatever follows', () => {
    const rows = rowsFor([
      deny(ALICE, documentScope(SECRET)),
      allow(ALICE, documentScope(SECRET), 'owner'),
    ])

    expect(rows).toEqual([{ documentId: SECRET, principal: ALICE, role: 'viewer', effect: 'deny' }])
  })

  it('lets a deny beat an allow written before it at the same scope', () => {
    const rows = rowsFor([
      allow(ALICE, documentScope(SECRET), 'owner'),
      deny(ALICE, documentScope(SECRET)),
    ])

    expect(rows).toEqual([{ documentId: SECRET, principal: ALICE, role: 'viewer', effect: 'deny' }])
  })

  it('takes the highest of several allows at one scope', () => {
    expect(
      rowsFor([
        allow(ALICE, documentScope(INTRO), 'viewer'),
        allow(ALICE, documentScope(INTRO), 'admin'),
        allow(ALICE, documentScope(INTRO), 'contributor'),
      ]),
    ).toEqual([{ documentId: INTRO, principal: ALICE, role: 'admin', effect: 'allow' }])
  })

  it('keeps one row per principal', () => {
    const rows = rowsFor([
      allow(ALICE, workspaceScope(WORKSPACE), 'editor'),
      allow(PLATFORM, collectionScope(GUIDES), 'viewer'),
      allow(PUBLIC_PRINCIPAL, documentScope(INTRO), 'viewer'),
      allow(BOB, collectionScope(OTHER_COLLECTION), 'owner'),
    ])

    expect(rows).toEqual([
      { documentId: INTRO, principal: ALICE, role: 'editor', effect: 'allow' },
      { documentId: INTRO, principal: PLATFORM, role: 'viewer', effect: 'allow' },
      { documentId: INTRO, principal: PUBLIC_PRINCIPAL, role: 'viewer', effect: 'allow' },
      { documentId: SECRET, principal: ALICE, role: 'editor', effect: 'allow' },
      { documentId: SECRET, principal: PLATFORM, role: 'viewer', effect: 'allow' },
    ])
  })

  it('is reproducible', () => {
    const grants = [
      allow(ALICE, unitScope(ROOT), 'viewer'),
      allow(PLATFORM, documentScope(INTRO), 'editor'),
    ]
    expect(rowsFor(grants)).toEqual(rowsFor(grants))
  })

  it('fails on a broken unit tree', () => {
    const result = materialiseEffectivePermissions({
      tree: { ...tree, workspace: { ...workspace, unitId: MISSING } },
      grants: [],
    })
    expect(result).toEqual({ ok: false, error: { kind: 'unknown-unit', unitId: MISSING } })
  })

  it('fails when a collection belongs to another workspace', () => {
    const result = materialiseEffectivePermissions({
      tree: {
        ...tree,
        collections: [
          { collection: { ...guides, workspaceId: OTHER_WORKSPACE }, documents: [doc(INTRO)] },
        ],
      },
      grants: [],
    })
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'collection-outside-workspace',
        collectionId: GUIDES,
        workspaceId: WORKSPACE,
      },
    })
  })

  it('fails when a document is filed under the wrong collection', () => {
    const result = materialiseEffectivePermissions({
      tree: {
        ...tree,
        collections: [
          {
            collection: guides,
            documents: [doc(INTRO, { collectionId: OTHER_COLLECTION })],
          },
        ],
      },
      grants: [],
    })
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'document-outside-collection',
        documentId: INTRO,
        collectionId: GUIDES,
      },
    })
  })

  it('lets a grant on an ancestor document reach every descendant', () => {
    const rows = rowsFor([allow(ALICE, documentScope(INTRO), 'editor')], nestedTree)
    expect(rows).toEqual([
      { documentId: INTRO, principal: ALICE, role: 'editor', effect: 'allow' },
      { documentId: CHILD, principal: ALICE, role: 'editor', effect: 'allow' },
      { documentId: GRANDCHILD, principal: ALICE, role: 'editor', effect: 'allow' },
    ])
  })

  it('lets a nearer document override what a farther ancestor granted', () => {
    const rows = rowsFor(
      [allow(ALICE, documentScope(INTRO), 'editor'), allow(ALICE, documentScope(CHILD), 'viewer')],
      nestedTree,
    )
    expect(rows).toEqual([
      { documentId: INTRO, principal: ALICE, role: 'editor', effect: 'allow' },
      { documentId: CHILD, principal: ALICE, role: 'viewer', effect: 'allow' },
      { documentId: GRANDCHILD, principal: ALICE, role: 'viewer', effect: 'allow' },
    ])
  })

  it('lets a deny on a child override an allow on its parent, and inherits the deny further down', () => {
    const rows = rowsFor(
      [allow(ALICE, documentScope(INTRO), 'editor'), deny(ALICE, documentScope(CHILD))],
      nestedTree,
    )
    expect(rows).toEqual([
      { documentId: INTRO, principal: ALICE, role: 'editor', effect: 'allow' },
      { documentId: CHILD, principal: ALICE, role: 'viewer', effect: 'deny' },
      { documentId: GRANDCHILD, principal: ALICE, role: 'viewer', effect: 'deny' },
    ])
  })

  it('fails when a document points to an unknown parent', () => {
    const result = materialiseEffectivePermissions({
      tree: {
        ...tree,
        collections: [
          { collection: guides, documents: [doc(INTRO, { parentId: UNKNOWN_PARENT })] },
        ],
      },
      grants: [],
    })
    expect(result).toEqual({
      ok: false,
      error: { kind: 'unknown-document', documentId: UNKNOWN_PARENT },
    })
  })

  it('fails instead of looping when a document is its own parent', () => {
    const result = materialiseEffectivePermissions({
      tree: {
        ...tree,
        collections: [{ collection: guides, documents: [doc(INTRO, { parentId: INTRO })] }],
      },
      grants: [],
    })
    expect(result).toEqual({
      ok: false,
      error: { kind: 'document-cycle', documentId: INTRO },
    })
  })

  it('fails when an ancestor document belongs to another collection', () => {
    const result = materialiseEffectivePermissions({
      tree: {
        ...tree,
        collections: [
          { collection: guides, documents: [doc(CHILD, { parentId: FOREIGN_ANCESTOR })] },
          {
            collection: { ...guides, id: OTHER_COLLECTION },
            documents: [doc(FOREIGN_ANCESTOR, { collectionId: OTHER_COLLECTION })],
          },
        ],
      },
      grants: [],
    })
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'document-ancestor-outside-collection',
        documentId: FOREIGN_ANCESTOR,
        collectionId: GUIDES,
      },
    })
  })
})
