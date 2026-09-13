import type { UserId, WorkspaceId } from '@quill/domain'

import type { Clock, IdGenerator } from '../ports/system.ts'
import type { UnitId, UnitOfWork, UnitRow, WorkspaceRow } from '../ports/persistence.ts'
import { namedSlug } from './document-path.ts'

/**
 * Units and workspaces: the containers a body of documentation hangs off
 * (ADR-012).
 *
 * These were repository calls from the route layer, which broke rule 3 and —
 * the part that mattered — meant that creating, renaming or deleting a unit
 * or a workspace wrote no audit row at all (review finding L6). Changing the
 * shape of the organisation is administration, and ADR-011 asks for
 * administrative actions to be audited; the vocabulary already existed, and
 * nothing was reaching it.
 *
 * Each is a command with a `Result`-shaped answer, so the route maps outcomes
 * to status codes and decides nothing itself.
 */

export const TENANCY_AUDIT_EVENTS = {
  unitCreated: 'unit.created',
  unitRenamed: 'unit.renamed',
  unitDeleted: 'unit.deleted',
  workspaceCreated: 'workspace.created',
  workspaceRenamed: 'workspace.renamed',
  workspaceDeleted: 'workspace.deleted',
} as const

export interface TenancyDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export interface CreateUnitCommand {
  readonly parentId: UnitId | null
  readonly name: string
  readonly slug?: string | undefined
  readonly label?: string | undefined
  readonly createdBy: UserId
}

export type CreateUnitResult =
  | { readonly kind: 'created'; readonly unit: UnitRow }
  /** A parent that is not there would put the new unit outside every chain. */
  | { readonly kind: 'parent-not-found' }

export async function createUnit(
  deps: TenancyDependencies,
  command: CreateUnitCommand,
): Promise<CreateUnitResult> {
  const { repos } = deps.uow
  if (command.parentId !== null && (await repos.units.findById(command.parentId)) === null) {
    return { kind: 'parent-not-found' }
  }

  const unit = await repos.units.create({
    id: deps.ids.uuid(),
    parentId: command.parentId,
    name: command.name,
    slug: command.slug ?? namedSlug(command.name),
    // The neutral noun, until an administrator says "company" or "team".
    label: command.label ?? 'unit',
    now: deps.clock.now(),
  })
  await audit(deps, {
    type: TENANCY_AUDIT_EVENTS.unitCreated,
    actorUserId: command.createdBy,
    targetType: 'unit',
    targetId: unit.id,
    metadata: { name: unit.name, slug: unit.slug, parentId: unit.parentId },
  })
  return { kind: 'created', unit }
}

export interface RenameUnitCommand {
  readonly unitId: UnitId
  readonly name: string
  readonly renamedBy: UserId
}

export type RenameUnitResult =
  | { readonly kind: 'renamed'; readonly unit: UnitRow }
  | { readonly kind: 'not-found' }

export async function renameUnit(
  deps: TenancyDependencies,
  command: RenameUnitCommand,
): Promise<RenameUnitResult> {
  const { repos } = deps.uow
  const existing = await repos.units.findById(command.unitId)
  if (existing === null) return { kind: 'not-found' }

  const unit = await repos.units.rename(command.unitId, command.name)
  await audit(deps, {
    type: TENANCY_AUDIT_EVENTS.unitRenamed,
    actorUserId: command.renamedBy,
    targetType: 'unit',
    targetId: unit.id,
    metadata: { from: existing.name, to: unit.name },
  })
  return { kind: 'renamed', unit }
}

export interface DeleteUnitCommand {
  readonly unitId: UnitId
  readonly deletedBy: UserId
}

export type DeleteUnitResult =
  | { readonly kind: 'deleted' }
  | { readonly kind: 'not-found' }
  /** Deleting it would take its workspaces and child units with it. */
  | { readonly kind: 'not-empty'; readonly workspaces: number; readonly units: number }

export async function deleteUnit(
  deps: TenancyDependencies,
  command: DeleteUnitCommand,
): Promise<DeleteUnitResult> {
  const { repos } = deps.uow
  const existing = await repos.units.findById(command.unitId)
  if (existing === null) return { kind: 'not-found' }

  const [workspaces, children] = await Promise.all([
    repos.workspaces.listByUnit(command.unitId),
    repos.units.listChildren(command.unitId),
  ])
  // `organisational_units.parent_id` and `workspaces.unit_id` cascade, so
  // deleting a populated unit would silently take a whole tree of
  // documentation with it. The caller empties it first, deliberately.
  if (workspaces.length > 0 || children.length > 0) {
    return { kind: 'not-empty', workspaces: workspaces.length, units: children.length }
  }

  await repos.units.delete(command.unitId)
  await audit(deps, {
    type: TENANCY_AUDIT_EVENTS.unitDeleted,
    actorUserId: command.deletedBy,
    targetType: 'unit',
    targetId: existing.id,
    metadata: { name: existing.name, slug: existing.slug },
  })
  return { kind: 'deleted' }
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export interface CreateWorkspaceCommand {
  readonly unitId: UnitId
  readonly name: string
  readonly slug: string
  readonly createdBy: UserId
}

export type CreateWorkspaceResult =
  | { readonly kind: 'created'; readonly workspace: WorkspaceRow }
  | { readonly kind: 'unit-not-found' }
  | { readonly kind: 'slug-taken'; readonly slug: string }

export async function createWorkspace(
  deps: TenancyDependencies,
  command: CreateWorkspaceCommand,
): Promise<CreateWorkspaceResult> {
  const { repos } = deps.uow
  if ((await repos.units.findById(command.unitId)) === null) return { kind: 'unit-not-found' }
  // The slug is unique across the instance, because it is what a published
  // site is addressed by.
  if ((await repos.workspaces.findBySlug(command.slug)) !== null) {
    return { kind: 'slug-taken', slug: command.slug }
  }

  const workspace = await repos.workspaces.create({
    id: deps.ids.uuid() as WorkspaceId,
    unitId: command.unitId,
    name: command.name,
    slug: command.slug,
    now: deps.clock.now(),
  })
  await audit(deps, {
    type: TENANCY_AUDIT_EVENTS.workspaceCreated,
    actorUserId: command.createdBy,
    targetType: 'workspace',
    targetId: workspace.id,
    metadata: { unitId: workspace.unitId, name: workspace.name, slug: workspace.slug },
  })
  return { kind: 'created', workspace }
}

export interface RenameWorkspaceCommand {
  readonly workspaceId: WorkspaceId
  readonly name: string
  /**
   * The slug to move to. Omitted leaves it exactly where it is, which is what
   * an ordinary rename does: the slug is in every link anybody has pasted, so
   * moving it is a separate, deliberate instruction (ADR-035).
   */
  readonly slug?: string | undefined
  readonly renamedBy: UserId
}

export type RenameWorkspaceResult =
  | { readonly kind: 'renamed'; readonly workspace: WorkspaceRow }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'slug-taken'; readonly slug: string }

export async function renameWorkspace(
  deps: TenancyDependencies,
  command: RenameWorkspaceCommand,
): Promise<RenameWorkspaceResult> {
  const { repos } = deps.uow
  const existing = await repos.workspaces.findById(command.workspaceId)
  if (existing === null) return { kind: 'not-found' }

  const nextSlug = command.slug
  const moving = nextSlug !== undefined && nextSlug !== existing.slug
  if (moving && (await repos.workspaces.findBySlug(nextSlug)) !== null) {
    return { kind: 'slug-taken', slug: nextSlug }
  }

  // Moving the slug and recording the one it left behind are one transaction:
  // a workspace that answered to a slug a moment ago has to keep answering to
  // it, and a forwarding address written separately could be lost (ADR-035).
  const now = deps.clock.now()
  const workspace = await deps.uow.run(async (tx) => {
    const renamed = await tx.workspaces.rename(command.workspaceId, command.name, nextSlug)
    if (moving) {
      await tx.workspaceSlugHistory.record({
        workspaceId: existing.id,
        slug: existing.slug,
        now,
      })
    }
    return renamed
  })

  await audit(deps, {
    type: TENANCY_AUDIT_EVENTS.workspaceRenamed,
    actorUserId: command.renamedBy,
    targetType: 'workspace',
    targetId: workspace.id,
    metadata: {
      from: existing.name,
      to: workspace.name,
      slug: workspace.slug,
      ...(moving ? { retiredSlug: existing.slug } : {}),
    },
  })
  return { kind: 'renamed', workspace }
}

export interface DeleteWorkspaceCommand {
  readonly workspaceId: WorkspaceId
  readonly deletedBy: UserId
}

export type DeleteWorkspaceResult =
  | { readonly kind: 'deleted'; readonly documents: number }
  | { readonly kind: 'not-found' }

export async function deleteWorkspace(
  deps: TenancyDependencies,
  command: DeleteWorkspaceCommand,
): Promise<DeleteWorkspaceResult> {
  const { repos } = deps.uow
  const existing = await repos.workspaces.findById(command.workspaceId)
  if (existing === null) return { kind: 'not-found' }

  // How much went with it, recorded before it goes: a workspace cascades to
  // its collections, documents, drafts and revisions index, and "somebody
  // deleted Engineering" is a question the audit log has to be able to answer
  // with a number.
  const documents = await repos.documents.listByWorkspace(command.workspaceId)
  await repos.workspaces.delete(command.workspaceId)
  await audit(deps, {
    type: TENANCY_AUDIT_EVENTS.workspaceDeleted,
    actorUserId: command.deletedBy,
    targetType: 'workspace',
    targetId: existing.id,
    metadata: { name: existing.name, slug: existing.slug, documents: documents.length },
  })
  return { kind: 'deleted', documents: documents.length }
}

async function audit(
  deps: TenancyDependencies,
  event: {
    readonly type: string
    readonly actorUserId: UserId
    readonly targetType: string
    readonly targetId: string
    readonly metadata: Readonly<Record<string, unknown>>
  },
): Promise<void> {
  await deps.uow.repos.audit.write({
    id: deps.ids.uuid(),
    type: event.type,
    actorUserId: event.actorUserId,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata: event.metadata,
    now: deps.clock.now(),
  })
}
