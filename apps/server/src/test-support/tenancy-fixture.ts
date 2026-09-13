import { createGrant } from '@quill/application'

import { userId } from '@quill/domain'
import type { CollectionId, UserId, WorkspaceId } from '@quill/domain'

import { grantInstanceAdmin } from '../application/auth-service.ts'
import type { ServerHarness } from './harness.ts'

/**
 * One unit, one workspace, one collection, and three people with different
 * grants: an instance administrator, an editor, and a viewer.
 *
 * Almost every integration test needs the same tenancy to have something to
 * authorise against, and stating it once keeps each test about the behaviour
 * it is actually checking.
 */

export interface TenancyFixture {
  readonly unitId: string
  readonly workspaceId: WorkspaceId
  readonly collectionId: CollectionId
  readonly admin: UserId
  readonly editor: UserId
  readonly viewer: UserId
  readonly outsider: UserId
}

const ADMIN = userId('00000000-0000-4000-8000-00000000a001')
const EDITOR = userId('00000000-0000-4000-8000-00000000a002')
const VIEWER = userId('00000000-0000-4000-8000-00000000a003')
const OUTSIDER = userId('00000000-0000-4000-8000-00000000a004')

export async function seedTenancy(harness: ServerHarness): Promise<TenancyFixture> {
  const { repos } = harness.deps.uow
  const now = harness.clock.now()
  const ids = harness.deps.ids

  for (const [id, name] of [
    [ADMIN, 'Admin'],
    [EDITOR, 'Editor'],
    [VIEWER, 'Viewer'],
    [OUTSIDER, 'Outsider'],
  ] as const) {
    await repos.users.create({
      id,
      email: `${name.toLowerCase()}@example.com`,
      displayName: name,
      now,
    })
    // ADR-011 requires a verified address before a user may act beyond
    // their own profile, so the fixture's people are verified; the denial
    // itself is tested in `tenancy.integration.test.ts`.
    await repos.users.markEmailVerified(id, now)
  }
  // Through the service, not the repository: a privilege change rotates the
  // affected user's sessions and writes an audit row, and a fixture that set
  // the flag directly would be the one path in the codebase that did neither
  // (review finding M11).
  await grantInstanceAdmin(harness.deps, { actor: null, target: ADMIN })

  const unit = await repos.units.create({
    id: ids.uuid(),
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now,
  })
  const workspace = await repos.workspaces.create({
    id: ids.uuid() as WorkspaceId,
    unitId: unit.id,
    name: 'Engineering',
    slug: 'engineering',
    now,
  })
  const collection = await repos.collections.create({
    id: ids.uuid() as CollectionId,
    workspaceId: workspace.id,
    name: 'Architecture',
    slug: 'architecture',
    now,
  })

  for (const [user, role] of [
    [EDITOR, 'editor'],
    [VIEWER, 'viewer'],
  ] as const) {
    // Through the use case, not the repository: the fixture's grants go in the
    // same way a real one does, past the domain's rules (ADR-012).
    const granted = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: user,
      scopeKind: 'workspace',
      scopeId: workspace.id,
      role,
      effect: 'allow',
      createdBy: ADMIN,
    })
    /* v8 ignore next -- the fixture's grants are valid by construction. */
    if (granted.kind !== 'created') throw new Error(`fixture grant rejected: ${granted.kind}`)
  }

  return {
    unitId: unit.id,
    workspaceId: workspace.id,
    collectionId: collection.id as CollectionId,
    admin: ADMIN,
    editor: EDITOR,
    viewer: VIEWER,
    outsider: OUTSIDER,
  }
}
