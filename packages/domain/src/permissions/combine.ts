import type { Role } from '../roles.ts'
import { roleAtLeast } from '../roles.ts'
import type { GrantEffect } from './grant.ts'
import type { Principal } from './principal.ts'
import type { Scope } from './scope.ts'

/**
 * One principal's say in what a request may do to one document (ADR-012).
 *
 * A principal contributes exactly once per document: the nearest scope on that
 * document's chain carrying a grant for it, and what that scope's grants say.
 * `depth` counts down the chain from the instance, which is 0, to the document
 * itself, which is deepest — so a larger depth is nearer the document.
 * Contributions are only ever compared within one document, where they all sit
 * on the same chain.
 */
export interface Contribution {
  readonly principal: Principal
  readonly role: Role
  readonly effect: GrantEffect
  readonly depth: number
  readonly scope: Scope
}

/** The role a document's contributions settle on, and the one that settled it. */
export interface CombinedPermission<C extends Contribution> {
  readonly role: Role | null

  /**
   * The winning allow when access is granted, the deny that refused it when it
   * is not, and null when no principal contributed at all.
   */
  readonly decidedBy: C | null
}

/**
 * Combines one document's contributions into the role a request holds over it.
 *
 * Resolution is per principal and only then combined, which is what makes
 * signing in safe: the public principal is held by every request, so if a
 * public viewer grant could replace what a member's own grant said, signing in
 * would take access away. Here a principal's grant can only lower that same
 * principal, never anyone else.
 *
 * A deny on a person — a user or a group — withholds the document from them
 * however else they reach it, so it discards every allow that is not
 * *strictly* nearer the document than it is, whoever holds that allow: an
 * explicit allow below the deny is a deliberate exception and survives, an
 * allow at the same scope loses to it, and an allow inherited from a broader
 * scope loses to it. Whatever survives is combined by taking the highest role.
 *
 * A deny on the public principal or a share link closes a *channel*, not a
 * person, so it removes only its own principal's contribution. A public grant
 * is publication (ADR-012), and every request holds the public principal:
 * carving one document out of a public collection must take it off the public
 * web without also hiding it from the members who work on it.
 *
 * `resolvePermission` and the consumers of the materialised
 * effective-permission table both finish here, so the two cannot drift apart.
 */
export function combineContributions<C extends Contribution>(
  contributions: Iterable<C>,
): CombinedPermission<C> {
  let withdrawn: C | null = null
  let closed: C | null = null
  const allows: C[] = []

  for (const contribution of contributions) {
    if (contribution.effect === 'allow') {
      allows.push(contribution)
    } else if (isChannel(contribution.principal)) {
      if (closed === null || contribution.depth > closed.depth) closed = contribution
    } else if (withdrawn === null || contribution.depth > withdrawn.depth) {
      withdrawn = contribution
    }
  }

  let winner: C | null = null
  for (const allow of allows) {
    if (withdrawn !== null && allow.depth <= withdrawn.depth) continue
    if (winner === null || outranks(allow, winner)) winner = allow
  }

  if (winner !== null) return { role: winner.role, decidedBy: winner }
  // A withdrawal explains the refusal better than a closed channel, and a
  // closed channel explains it better than nothing: an anonymous reader denied
  // one document of a public collection was refused by that deny.
  return { role: null, decidedBy: withdrawn ?? closed }
}

/**
 * Whether a principal names a way in rather than somebody.
 *
 * The public principal and share links are channels: every request holds
 * `public`, and a share link is a URL somebody followed. A user or a group
 * names a person, and denying a person means it whatever door they came
 * through.
 */
function isChannel(principal: Principal): boolean {
  return principal.kind === 'public' || principal.kind === 'share-link'
}

/**
 * A strictly higher role wins outright; between equal roles the nearer scope
 * wins, because it is the better explanation of where the access came from.
 */
function outranks(candidate: Contribution, best: Contribution): boolean {
  return candidate.role === best.role
    ? candidate.depth > best.depth
    : roleAtLeast(candidate.role, best.role)
}

/**
 * Whether one grant replaces a principal's verdict at the scope they share.
 *
 * A deny beats any allow there whatever role it records, and otherwise only a
 * strictly higher role wins, so the first grant written keeps a tie and the
 * result does not depend on the order a query happened to return.
 */
export function supersedesAtScope(
  candidate: Pick<Contribution, 'effect' | 'role'>,
  current: Pick<Contribution, 'effect' | 'role'>,
): boolean {
  if (current.effect === 'deny') return false
  if (candidate.effect === 'deny') return true
  return !roleAtLeast(current.role, candidate.role)
}
