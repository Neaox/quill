import { validateGrant } from '@quill/domain'
import type { GrantViolation, Role, UserId } from '@quill/domain'

import type {
  CreateGrantInput,
  GrantEffect,
  GrantRow,
  PrincipalKind,
  RepositoryBundle,
  ScopeKind,
  UnitOfWork,
} from '../ports/persistence.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { toGrants } from './authorizer.ts'
import { grantChange, grantCreated } from './events.ts'

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
 *
 * Creating one is announced (`GrantCreated`, ADR-052) in the transaction that
 * stores it, so what is derived from who may read what — the public site's
 * cache now, the effective-permission table later — is told in the same
 * breath and cannot be left to catch up on a clock.
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
  return deps.uow.run((tx) => createGrantIn(deps, tx, command))
}

/**
 * The same command inside a transaction that is already open, for a use case
 * that grants as part of something larger (publishing a collection).
 */
export async function createGrantIn(
  deps: Pick<CreateGrantDependencies, 'clock' | 'ids'>,
  tx: RepositoryBundle,
  command: CreateGrantCommand,
): Promise<CreateGrantResult> {
  const id = deps.ids.uuid()
  const now = deps.clock.now()

  const [grant] = [...toGrants([{ ...command, id, createdAt: now }])]
  if (grant === undefined) return { kind: 'malformed' }

  const validated = validateGrant(grant)
  if (!validated.ok) return { kind: 'rejected', violations: validated.error }

  const input: CreateGrantInput = { ...command, id, now }
  const created = await tx.grants.create(input)
  await tx.events.record(grantCreated, grantChange(created), now)
  return { kind: 'created', grant: created }
}
