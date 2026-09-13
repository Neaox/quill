import type { Role } from '../roles.ts'
import type { Capabilities } from './capabilities.ts'
import { NO_CAPABILITIES, capabilitiesForRole } from './capabilities.ts'
import type { Contribution } from './combine.ts'
import { combineContributions, supersedesAtScope } from './combine.ts'
import type { Grant } from './grant.ts'
import type { Principal } from './principal.ts'
import { principalKey } from './principal.ts'
import type { ScopeChain } from './scope-chain.ts'
import type { Scope } from './scope.ts'
import { scopeKey } from './scope.ts'

/** What a request may do to one document, and which grant said so. */
export interface EffectivePermission {
  readonly role: Role | null
  readonly capabilities: Capabilities

  /** The scope that settled it, or null when nothing on the chain applied. */
  readonly decidedAt: Scope | null

  /** The grant that settled it, for audit and for explaining access in the UI. */
  readonly by: Grant | null
}

/** No grant on the chain matched the request. */
export const NO_PERMISSION: EffectivePermission = {
  role: null,
  capabilities: NO_CAPABILITIES,
  decidedAt: null,
  by: null,
}

export interface ResolvePermissionInput {
  readonly chain: ScopeChain
  readonly identities: Iterable<Principal>
  readonly grants: Iterable<Grant>
}

/** A principal's contribution, carrying the grant behind it for audit. */
interface GrantContribution extends Contribution {
  readonly grant: Grant
}

/**
 * Resolves the role a request holds over a document (ADR-012).
 *
 * Each principal the request holds speaks once, from the nearest scope on the
 * chain that grants to it — so a grant on a document or collection replaces
 * what a unit said *for that principal*, rather than for everyone. The
 * principals are then combined by `combineContributions`, which is also where
 * the materialised effective-permission table ends up, so a list view and a
 * direct check can never disagree, and which is where a deny on a person is
 * told apart from a deny on the public principal or a share link.
 */
export function resolvePermission(input: ResolvePermissionInput): EffectivePermission {
  const combined = combineContributions(contributionsOnChain(input))
  if (combined.decidedBy === null) return NO_PERMISSION

  return {
    role: combined.role,
    capabilities: combined.role === null ? NO_CAPABILITIES : capabilitiesForRole(combined.role),
    decidedAt: combined.decidedBy.scope,
    by: combined.decidedBy.grant,
  }
}

/**
 * What each held principal contributes: the verdict of the nearest scope on
 * the chain that carries a grant for it.
 *
 * Grants are bucketed by scope first so the chain is walked once however many
 * grants there are, which matters on a deep tree with a busy instance-level
 * grant list.
 */
function contributionsOnChain(input: ResolvePermissionInput): Iterable<GrantContribution> {
  const identityKeys = new Set<string>()
  for (const principal of input.identities) identityKeys.add(principalKey(principal))

  const matchingByScope = new Map<string, Grant[]>()
  for (const grant of input.grants) {
    if (!identityKeys.has(principalKey(grant.principal))) continue
    const key = scopeKey(grant.scope)
    const atScope = matchingByScope.get(key)
    if (atScope === undefined) matchingByScope.set(key, [grant])
    else atScope.push(grant)
  }

  const contributions = new Map<string, GrantContribution>()
  const deepest = input.chain.length - 1

  for (const [index, scope] of input.chain.entries()) {
    const atScope = matchingByScope.get(scopeKey(scope))
    if (atScope === undefined) continue
    const depth = deepest - index

    for (const grant of atScope) {
      const key = principalKey(grant.principal)
      const current = contributions.get(key)
      // The chain is walked nearest first, so a principal that has already
      // spoken from a nearer scope has nothing to add here.
      if (current !== undefined && current.depth > depth) continue
      if (current === undefined || supersedesAtScope(grant, current)) {
        contributions.set(key, {
          grant,
          principal: grant.principal,
          role: grant.role,
          effect: grant.effect,
          depth,
          scope,
        })
      }
    }
  }

  return contributions.values()
}
