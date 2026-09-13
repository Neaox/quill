import type { Result } from '../result.ts'
import { err, ok } from '../result.ts'
import type { Role } from '../roles.ts'
import type { Principal } from './principal.ts'
import type { Scope, ScopeKind } from './scope.ts'

export const GRANT_EFFECTS = ['allow', 'deny'] as const

export type GrantEffect = (typeof GRANT_EFFECTS)[number]

/** A role given to (or withheld from) a principal at one scope. */
export interface Grant {
  readonly principal: Principal
  readonly scope: Scope
  readonly role: Role
  readonly effect: GrantEffect
}

export type GrantViolation =
  | { readonly kind: 'deny-outside-document-scope'; readonly scope: ScopeKind }
  | { readonly kind: 'public-principal-above-viewer'; readonly role: Role }

/**
 * Checks the two rules a grant must satisfy before it is stored.
 *
 * Deny exists for one purpose, a private document inside a shared collection
 * (ADR-012). Allowing it higher up would make a whole subtree's access depend
 * on which grant an administrator happened to write last, so it is confined to
 * document scope. The public principal is capped at viewer because anonymous
 * readers must never be able to change content.
 *
 * Every violation is reported together so an administrator fixes the grant once
 * rather than being corrected one rule at a time.
 */
export function validateGrant(grant: Grant): Result<Grant, readonly GrantViolation[]> {
  const violations: GrantViolation[] = []

  if (grant.effect === 'deny' && grant.scope.kind !== 'document') {
    violations.push({ kind: 'deny-outside-document-scope', scope: grant.scope.kind })
  }

  if (grant.principal.kind === 'public' && grant.role !== 'viewer') {
    violations.push({ kind: 'public-principal-above-viewer', role: grant.role })
  }

  return violations.length === 0 ? ok(grant) : err(violations)
}
