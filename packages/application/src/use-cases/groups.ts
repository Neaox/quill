import type { UserId } from '@quill/domain'

import type { Clock, IdGenerator } from '../ports/system.ts'
import type { GroupId, GroupRow, UnitId, UnitOfWork, UnitRow } from '../ports/persistence.ts'

/**
 * Groups and their members: the administration behind "give the design team
 * access" (ADR-012, ADR-052).
 *
 * Each is a command answered with a `Result`-shaped value, so the route maps
 * outcomes to status codes and decides nothing itself, and each writes its
 * audit row (ADR-011): who is in a group decides who can read what, so
 * changing it is administration.
 *
 * Nesting is fixed when a group is created and there is no way to move one,
 * so a cycle cannot be made: a new group is never its own ancestor. The one
 * rule left to enforce is that a group nests inside a group of its own unit,
 * because a grant to a parent reaches its children and a parent from another
 * unit would carry that reach across the unit boundary.
 */

export const GROUP_AUDIT_EVENTS = {
  created: 'group.created',
  renamed: 'group.renamed',
  deleted: 'group.deleted',
  memberAdded: 'group.member_added',
  memberRemoved: 'group.member_removed',
} as const

/** The most people one search returns; the picker is not a directory browser. */
export const GROUP_PEOPLE_SEARCH_LIMIT = 20

export interface GroupsDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface GroupSummary {
  readonly id: GroupId
  readonly name: string
  readonly unitId: UnitId
  /** The unit's name under every unit above it, such as "Acme / Platform". */
  readonly unitPath: string
  readonly parentGroupId: GroupId | null
  readonly memberCount: number
}

export interface Person {
  readonly id: UserId
  readonly name: string
  readonly email: string
}

const normalise = (name: string): string => name.trim().toLowerCase()

/**
 * The unit path of every unit, from one listing rather than one query per
 * unit: each unit's path is its parent's path plus its own name.
 */
function unitPaths(units: readonly UnitRow[]): ReadonlyMap<UnitId, string> {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const paths = new Map<UnitId, string>()
  const pathOf = (unit: UnitRow, seen: ReadonlySet<UnitId>): string => {
    const known = paths.get(unit.id)
    if (known !== undefined) return known
    const parent = unit.parentId === null ? undefined : byId.get(unit.parentId)
    const path =
      parent === undefined || seen.has(parent.id)
        ? unit.name
        : `${pathOf(parent, new Set([...seen, unit.id]))} / ${unit.name}`
    paths.set(unit.id, path)
    return path
  }
  for (const unit of units) pathOf(unit, new Set())
  return paths
}

export async function listGroups(deps: GroupsDependencies): Promise<readonly GroupSummary[]> {
  const { groups, units } = deps.uow.repos
  const [rows, allUnits, counts] = await Promise.all([
    groups.list(),
    units.listAll(),
    groups.countMembers(),
  ])
  const paths = unitPaths(allUnits)
  return rows
    .map((row): GroupSummary => ({
      id: row.id,
      name: row.name,
      unitId: row.unitId,
      unitPath: paths.get(row.unitId) ?? '',
      parentGroupId: row.parentGroupId,
      memberCount: counts.get(row.id) ?? 0,
    }))
    .toSorted((a, b) => a.unitPath.localeCompare(b.unitPath) || a.name.localeCompare(b.name))
}

export interface CreateGroupCommand {
  readonly unitId: UnitId
  readonly name: string
  readonly parentGroupId: GroupId | null
  readonly createdBy: UserId
}

export type CreateGroupResult =
  | { readonly kind: 'created'; readonly group: GroupRow }
  | { readonly kind: 'unit-not-found' }
  | { readonly kind: 'parent-not-found' }
  /** A parent in another unit would carry a grant to it across the unit boundary. */
  | { readonly kind: 'parent-in-another-unit' }
  | { readonly kind: 'name-taken' }

export async function createGroup(
  deps: GroupsDependencies,
  command: CreateGroupCommand,
): Promise<CreateGroupResult> {
  const { repos } = deps.uow
  if ((await repos.units.findById(command.unitId)) === null) return { kind: 'unit-not-found' }
  if (command.parentGroupId !== null) {
    const parent = await repos.groups.findById(command.parentGroupId)
    if (parent === null) return { kind: 'parent-not-found' }
    if (parent.unitId !== command.unitId) return { kind: 'parent-in-another-unit' }
  }
  const name = command.name.trim()
  if (
    await nameTaken(deps, { unitId: command.unitId, parentGroupId: command.parentGroupId, name })
  ) {
    return { kind: 'name-taken' }
  }

  const group = await repos.groups.create({
    id: deps.ids.uuid(),
    unitId: command.unitId,
    parentGroupId: command.parentGroupId,
    name,
    now: deps.clock.now(),
  })
  await audit(deps, {
    type: GROUP_AUDIT_EVENTS.created,
    actorUserId: command.createdBy,
    targetId: group.id,
    metadata: { name, unitId: group.unitId, parentGroupId: group.parentGroupId },
  })
  return { kind: 'created', group }
}

export interface RenameGroupCommand {
  readonly groupId: GroupId
  readonly name: string
  readonly renamedBy: UserId
}

export type RenameGroupResult =
  | { readonly kind: 'renamed'; readonly group: GroupRow }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'name-taken' }

export async function renameGroup(
  deps: GroupsDependencies,
  command: RenameGroupCommand,
): Promise<RenameGroupResult> {
  const { repos } = deps.uow
  const existing = await repos.groups.findById(command.groupId)
  if (existing === null) return { kind: 'not-found' }
  const name = command.name.trim()
  if (await nameTaken(deps, { ...existing, name, ignoring: existing.id })) {
    return { kind: 'name-taken' }
  }

  const group = await repos.groups.rename(existing.id, name)
  await audit(deps, {
    type: GROUP_AUDIT_EVENTS.renamed,
    actorUserId: command.renamedBy,
    targetId: group.id,
    metadata: { from: existing.name, to: group.name },
  })
  return { kind: 'renamed', group }
}

export interface DeleteGroupCommand {
  readonly groupId: GroupId
  readonly deletedBy: UserId
}

export type DeleteGroupResult =
  /** How many memberships and grants went with it, for the confirmation and the audit row. */
  | { readonly kind: 'deleted'; readonly members: number; readonly grants: number }
  | { readonly kind: 'not-found' }
  /** `parent_id` has no cascade, so deleting a parent would orphan these. */
  | { readonly kind: 'has-children'; readonly children: number }

/**
 * Deletes a group together with its memberships and every grant that names
 * it, in one transaction. A grant to a group that no longer exists would be
 * dead weight at best, and at worst a principal that a later group could
 * never be confused with only because ids are never reused; removing it
 * leaves nothing that still looks like access.
 */
export async function deleteGroup(
  deps: GroupsDependencies,
  command: DeleteGroupCommand,
): Promise<DeleteGroupResult> {
  const existing = await deps.uow.repos.groups.findById(command.groupId)
  if (existing === null) return { kind: 'not-found' }

  const outcome = await deps.uow.run(async (tx) => {
    const children = await tx.groups.countChildren(existing.id)
    if (children > 0) return { kind: 'has-children', children } as const

    const [members, held] = await Promise.all([
      tx.groups.listMemberIds(existing.id),
      tx.grants.listForPrincipal('group', existing.id),
    ])
    await Promise.all(held.map((grant) => tx.grants.delete(grant.id)))
    await tx.groups.delete(existing.id)
    return { kind: 'deleted', members: members.length, grants: held.length } as const
  })
  if (outcome.kind === 'has-children') return outcome

  await audit(deps, {
    type: GROUP_AUDIT_EVENTS.deleted,
    actorUserId: command.deletedBy,
    targetId: existing.id,
    metadata: { name: existing.name, members: outcome.members, grants: outcome.grants },
  })
  return outcome
}

export async function listGroupMembers(
  deps: GroupsDependencies,
  groupId: GroupId,
): Promise<
  { readonly kind: 'members'; readonly members: readonly Person[] } | { readonly kind: 'not-found' }
> {
  const { groups, users } = deps.uow.repos
  if ((await groups.findById(groupId)) === null) return { kind: 'not-found' }
  const people = await users.listByIds(await groups.listMemberIds(groupId))
  return {
    kind: 'members',
    members: people.map(toPerson).toSorted((a, b) => a.name.localeCompare(b.name)),
  }
}

export interface GroupMemberCommand {
  readonly groupId: GroupId
  readonly userId: UserId
}

export type AddGroupMemberResult =
  | { readonly kind: 'added' }
  | { readonly kind: 'group-not-found' }
  | { readonly kind: 'user-not-found' }

/** Adding somebody already in the group changes nothing, so it is safe to repeat. */
export async function addGroupMember(
  deps: GroupsDependencies,
  command: GroupMemberCommand & { readonly addedBy: UserId },
): Promise<AddGroupMemberResult> {
  const { groups, users } = deps.uow.repos
  const group = await groups.findById(command.groupId)
  if (group === null) return { kind: 'group-not-found' }
  const user = await users.findById(command.userId)
  if (user === null) return { kind: 'user-not-found' }

  await groups.addMember({ groupId: group.id, userId: user.id, now: deps.clock.now() })
  await audit(deps, {
    type: GROUP_AUDIT_EVENTS.memberAdded,
    actorUserId: command.addedBy,
    targetId: group.id,
    metadata: { group: group.name, userId: user.id },
  })
  return { kind: 'added' }
}

export async function removeGroupMember(
  deps: GroupsDependencies,
  command: GroupMemberCommand & { readonly removedBy: UserId },
): Promise<{ readonly kind: 'removed' } | { readonly kind: 'not-found' }> {
  const { groups } = deps.uow.repos
  const group = await groups.findById(command.groupId)
  if (group === null) return { kind: 'not-found' }

  await groups.removeMember({ groupId: group.id, userId: command.userId })
  await audit(deps, {
    type: GROUP_AUDIT_EVENTS.memberRemoved,
    actorUserId: command.removedBy,
    targetId: group.id,
    metadata: { group: group.name, userId: command.userId },
  })
  return { kind: 'removed' }
}

export async function searchPeopleForGroups(
  deps: GroupsDependencies,
  query: { readonly query: string },
): Promise<readonly Person[]> {
  const found = await deps.uow.repos.users.searchByPrefix(
    query.query.trim(),
    GROUP_PEOPLE_SEARCH_LIMIT,
  )
  return found.map(toPerson)
}

const toPerson = (user: {
  readonly id: UserId
  readonly displayName: string
  readonly email: string
}): Person => ({ id: user.id, name: user.displayName, email: user.email })

/** Siblings (same unit, same parent) may not share a name, so the picker is never ambiguous. */
async function nameTaken(
  deps: GroupsDependencies,
  candidate: {
    readonly unitId: UnitId
    readonly parentGroupId: GroupId | null
    readonly name: string
    readonly ignoring?: GroupId
  },
): Promise<boolean> {
  const wanted = normalise(candidate.name)
  return (await deps.uow.repos.groups.list()).some(
    (group) =>
      group.id !== candidate.ignoring &&
      group.unitId === candidate.unitId &&
      group.parentGroupId === candidate.parentGroupId &&
      normalise(group.name) === wanted,
  )
}

async function audit(
  deps: GroupsDependencies,
  event: {
    readonly type: string
    readonly actorUserId: UserId
    readonly targetId: string
    readonly metadata: Readonly<Record<string, unknown>>
  },
): Promise<void> {
  await deps.uow.repos.audit.write({
    id: deps.ids.uuid(),
    type: event.type,
    actorUserId: event.actorUserId,
    targetType: 'group',
    targetId: event.targetId,
    metadata: event.metadata,
    now: deps.clock.now(),
  })
}
