import { canManage } from '@quill/domain'
import type { GroupId, UserId, WorkspaceId } from '@quill/domain'

import type { NewNotification } from '../ports/notifications.ts'
import type { UnitOfWork } from '../ports/persistence.ts'
import type { SourceSyncFailure } from '../ports/source-sync.ts'
import type { Clock } from '../ports/system.ts'
import { createAuthorizer, toSelector, workspaceChain } from './authorizer.ts'
import { sourceSyncRequested } from './events.ts'
import type { ShareLinkDependencies } from './share-links.ts'

/**
 * Keeping a sourced workspace fresh (ADR-061, "Freshness: one idempotent sync
 * job, three triggers"), apart from the webhook (`source-webhook.ts`): the
 * daily reconciliation, and telling the workspace's administrators when a
 * sync stops.
 */

/** How often every source is asked to sync by default: once a day (ADR-061). */
export const SOURCE_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * The safety net for deliveries that never arrived and sources that take no
 * webhook: one sync request for every sourced workspace. The sync job reads
 * the remote's head first and does nothing when it is the revision already
 * synced, so a request for an unchanged source costs one `ls-remote`.
 * Answers how many were asked.
 */
export async function reconcileSources(deps: {
  readonly uow: UnitOfWork
  readonly clock: Clock
}): Promise<number> {
  const workspaceIds = await deps.uow.repos.workspaceSources.listWorkspaceIds()
  if (workspaceIds.length === 0) return 0
  const now = deps.clock.now()
  await deps.uow.run(async (tx) => {
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's writes, on one connection
    for (const workspaceId of workspaceIds) {
      await tx.events.record(sourceSyncRequested, { workspaceId, trigger: 'schedule' }, now)
    }
  })
  return workspaceIds.length
}

/**
 * What makes two failures the same failure: why it stopped, and at which
 * source revision. The message is left out on purpose, because a command's
 * output can differ from one attempt to the next while nothing an
 * administrator could do about it has; a new revision that fails is a new
 * failure, since it is a new push someone may want to look at.
 */
export function sourceFailureKey(failure: SourceSyncFailure): string {
  return `${failure.reason}@${failure.revision ?? ''}`
}

/** More people than this are not the workspace's administrators but its readers. */
export const MAX_SOURCE_FAILURE_RECIPIENTS = 200

export type SourceFailureNotificationDependencies = ShareLinkDependencies

/**
 * Tells the workspace's administrators that its source stopped syncing, once
 * per distinct failure (ADR-061): a failure with the key they were last told
 * about is not told again, however many attempts it stops, and a sync that
 * finishes clears the key so the next failure is told. Answers how many
 * people were told.
 *
 * The administrators are everyone the authorizer gives `manage` of the
 * workspace through a grant, as it would on their own request, and the
 * instance administrator who configured the source.
 */
export async function notifySourceSyncFailure(
  deps: SourceFailureNotificationDependencies,
  workspaceId: WorkspaceId,
): Promise<number> {
  const state = await deps.uow.repos.sourceSyncState.find(workspaceId)
  if (state === null || state.failure === null) return 0
  const key = sourceFailureKey(state.failure)
  if (state.failureNotified === key) return 0

  const recipients = await sourceAdministrators(deps, workspaceId)
  const createdAt = deps.clock.now()
  const failure = { reason: state.failure.reason, revision: state.failure.revision }
  const occurrence = `${workspaceId}|${key}|${state.lastAttemptAt.toISOString()}`
  return await deps.uow.run(async (tx) => {
    if (!(await tx.sourceSyncState.recordFailureNotified({ workspaceId, key }))) return 0
    const rows = recipients.map((recipientUserId): NewNotification => ({
      id: deps.ids.uuid(),
      recipientUserId,
      kind: 'source-sync-failed',
      workspaceId,
      failure,
      occurrence,
      createdAt,
    }))
    return await tx.notifications.insertMany(rows)
  })
}

/** Whoever may manage the workspace, from the grants that could give it, checked one by one. */
async function sourceAdministrators(
  deps: SourceFailureNotificationDependencies,
  workspaceId: WorkspaceId,
): Promise<readonly UserId[]> {
  const { repos } = deps.uow
  const [workspace, source] = await Promise.all([
    repos.workspaces.findById(workspaceId),
    repos.workspaceSources.find(workspaceId),
  ])
  if (workspace === null) return []
  const chain = await workspaceChain(repos, workspace)
  const grants = chain.ok ? await repos.grants.listForScopes(chain.value.map(toSelector)) : []
  const managing = grants.filter((grant) => grant.effect === 'allow' && canManage(grant.role))
  const named = managing.flatMap((grant) =>
    grant.principalKind === 'user' && grant.principalId !== null
      ? [grant.principalId as UserId]
      : [],
  )
  const groups = managing.flatMap((grant) =>
    grant.principalKind === 'group' && grant.principalId !== null
      ? [grant.principalId as GroupId]
      : [],
  )
  const members = groups.length === 0 ? [] : await repos.reviews.listMemberIdsDeep(groups)
  const configurer = source?.configuredBy ?? null
  const candidates = [
    ...new Set([...(configurer === null ? [] : [configurer]), ...named, ...members]),
  ].slice(0, MAX_SOURCE_FAILURE_RECIPIENTS)

  const verdicts = await Promise.all(
    candidates.map((userId) =>
      createAuthorizer(repos, { userId, shareLinkToken: null }, deps).workspace(workspaceId),
    ),
  )
  return candidates.filter((_, index) => {
    const verdict = verdicts[index]
    return verdict?.ok === true && verdict.value.capabilities.manage
  })
}
