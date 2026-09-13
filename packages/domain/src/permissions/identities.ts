import type { GroupId, ShareLinkId } from '../ids.ts'
import type { Group } from '../tenancy/group.ts'
import type { User } from '../tenancy/user.ts'
import type { Principal } from './principal.ts'
import { PUBLIC_PRINCIPAL, groupPrincipal, shareLinkPrincipal, userPrincipal } from './principal.ts'

/**
 * Who a request acts as.
 *
 * The two cases carry different fields rather than sharing one shape with a
 * flag, so a signed-out request cannot accidentally arrive holding a user.
 */
export type RequestIdentity =
  | {
      readonly isAnonymous: true

      /** The share link the reader followed, if any. */
      readonly shareLinkId: ShareLinkId | null
    }
  | {
      readonly isAnonymous: false
      readonly user: User
      readonly groupIds: Iterable<GroupId>
      readonly groupsById: ReadonlyMap<GroupId, Group>
      readonly shareLinkId: ShareLinkId | null
    }

/**
 * Every principal whose grants apply to this request.
 *
 * The order is the user, then their groups and the groups those nest inside,
 * then the public principal, then the share link. Resolution treats the set as
 * unordered, so the order exists only to make results reproducible.
 */
export function principalIdentities(identity: RequestIdentity): readonly Principal[] {
  const principals: Principal[] = []

  if (!identity.isAnonymous) {
    principals.push(userPrincipal(identity.user.id))
    for (const id of expandGroups(identity.groupIds, identity.groupsById)) {
      principals.push(groupPrincipal(id))
    }
  }

  // Public grants apply to members too: a public collection is readable by
  // everyone, and signing in must never take access away.
  principals.push(PUBLIC_PRINCIPAL)

  if (identity.shareLinkId !== null) {
    principals.push(shareLinkPrincipal(identity.shareLinkId))
  }

  return principals
}

/**
 * The given groups followed by the groups they nest inside, each yielded once.
 *
 * A membership naming a group with no record still counts as that group; only
 * its ancestors cannot be walked. A parent pointer that loops stops at the
 * group already seen. Both cases narrow the identity set rather than widening
 * it, which is the safe direction for a broken group tree.
 */
function* expandGroups(
  groupIds: Iterable<GroupId>,
  groupsById: ReadonlyMap<GroupId, Group>,
): Generator<GroupId> {
  const seen = new Set<GroupId>()

  for (const start of groupIds) {
    let current: GroupId | null = start
    while (current !== null && !seen.has(current)) {
      seen.add(current)
      yield current
      current = groupsById.get(current)?.parentGroupId ?? null
    }
  }
}
