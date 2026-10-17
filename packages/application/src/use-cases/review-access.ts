import {
  PUBLIC_PRINCIPAL,
  groupPrincipal,
  principalIdentities,
  resolvePermission,
} from '@quill/domain'
import type { DocumentId, GroupId, Principal, ReviewerKind, UserId } from '@quill/domain'

import type { GrantRow } from '../ports/persistence.ts'
import { documentChain, toGrants, toSelector } from './authorizer.ts'
import type { AuthorizerRepositories } from './authorizer.ts'
import { toGroupEntity } from './tenancy-entities.ts'

/**
 * Whether somebody *else* could open a document: the question a review asks of
 * each person and group it tags (ADR-052).
 *
 * It reads the same chain and the same grants through the same domain
 * resolver as the authorizer does for a request, so there is one answer to
 * "who can see this", whoever is asking. The document's chain and grants are
 * loaded once and shared by every principal asked about.
 */

export interface ReviewerRef {
  readonly kind: ReviewerKind
  readonly id: string
}

export interface ReviewerAccessProbe {
  canView(reviewer: ReviewerRef): Promise<boolean>
}

/** A probe for one document, or null when the document cannot be placed in the tree. */
export async function createReviewerAccessProbe(
  repos: AuthorizerRepositories,
  documentId: DocumentId,
): Promise<ReviewerAccessProbe | null> {
  const document = await repos.documents.findById(documentId)
  if (document === null) return null
  const workspace = await repos.workspaces.findById(document.workspaceId)
  if (workspace === null) return null
  const chain = await documentChain(repos, document, workspace)
  if (!chain.ok) return null

  let grants: Promise<readonly GrantRow[]> | null = null
  const grantsOnChain = (): Promise<readonly GrantRow[]> => {
    grants ??= repos.grants.listForScopes(chain.value.map(toSelector))
    return grants
  }

  const sees = async (identities: readonly Principal[]): Promise<boolean> =>
    resolvePermission({
      chain: chain.value,
      identities,
      grants: [...toGrants(await grantsOnChain())],
    }).capabilities.view

  /** A group and the groups it nests inside: a member of the group holds all of them. */
  async function groupAndAncestors(start: GroupId): Promise<readonly GroupId[]> {
    const held: GroupId[] = []
    let current: GroupId | null = start
    while (current !== null && !held.includes(current)) {
      held.push(current)
      // Each parent is found from the one before.
      current = ((await repos.groups.findById(current))?.parentGroupId ?? null) as GroupId | null
    }
    return held
  }

  return {
    async canView(reviewer) {
      if (reviewer.kind === 'group') {
        if ((await repos.groups.findById(reviewer.id)) === null) return false
        const held = await groupAndAncestors(reviewer.id as GroupId)
        return sees([...held.map(groupPrincipal), PUBLIC_PRINCIPAL])
      }
      const [user, groups] = await Promise.all([
        repos.users.findById(reviewer.id as UserId),
        repos.groups.listForUser(reviewer.id as UserId),
      ])
      if (user === null) return false
      if (user.isInstanceAdmin) return true
      const groupsById = new Map(groups.map((group) => [group.id as GroupId, toGroupEntity(group)]))
      return sees(
        principalIdentities({
          isAnonymous: false,
          user: { id: user.id, name: user.displayName, email: user.email },
          groupIds: groupsById.keys(),
          groupsById,
          shareLinkId: null,
        }),
      )
    },
  }
}
