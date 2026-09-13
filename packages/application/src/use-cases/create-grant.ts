import { validateGrant } from '@quill/domain'
import type { GrantViolation, Role, UserId } from '@quill/domain'

import type {
  CreateGrantInput,
  GrantEffect,
  GrantRow,
  PrincipalKind,
  ScopeKind,
  UnitOfWork,
} from '../ports/persistence.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { toGrants } from './authorizer.ts'

/**
 * Writing a grant: the one way one gets stored (ADR-012).
 *
 * The rules a grant must satisfy — deny only at document scope, the public
 * principal never above viewer — are pure domain rules, but a pure function
 * nothing calls protects nothing. So the command is the boundary: it turns the
 * row a caller wants into the grant the domain understands, asks the domain
 * whether it is allowed, and only then writes it. A route, a seed, and a test
 * fixture all go through here, which is what keeps a deny above document scope
 * out of the database in the first place.
 */

export interface CreateGrantDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface CreateGrantCommand {
  readonly principalKind: PrincipalKind
  /** Null only for the `public` principal, which is a singleton. */
  readonly principalId: string | null
  readonly scopeKind: ScopeKind
  /** Null only for `instance` scope, which is a singleton scope. */
  readonly scopeId: string | null
  readonly role: Role
  readonly effect: GrantEffect
  readonly createdBy: UserId | null
}

export type CreateGrantResult =
  | { readonly kind: 'created'; readonly grant: GrantRow }
  | { readonly kind: 'rejected'; readonly violations: readonly GrantViolation[] }
  | {
      /** A principal or a scope that named no id where one is required, so it describes nothing. */
      readonly kind: 'malformed'
    }

export async function createGrant(
  deps: CreateGrantDependencies,
  command: CreateGrantCommand,
): Promise<CreateGrantResult> {
  const id = deps.ids.uuid()
  const now = deps.clock.now()

  const [grant] = [...toGrants([{ ...command, id, createdAt: now }])]
  if (grant === undefined) return { kind: 'malformed' }

  const validated = validateGrant(grant)
  if (!validated.ok) return { kind: 'rejected', violations: validated.error }

  const input: CreateGrantInput = { ...command, id, now }
  return { kind: 'created', grant: await deps.uow.repos.grants.create(input) }
}
