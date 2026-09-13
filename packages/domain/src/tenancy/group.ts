import type { GroupId, UnitId } from '../ids.ts'

/**
 * A named set of users, scoped to one organisational unit.
 *
 * Groups nest so that a grant to "Engineering" reaches the members of
 * "Engineering / Platform" without duplicating memberships; the shape maps onto
 * SCIM groups later without a schema change (ADR-012).
 */
export interface Group {
  readonly id: GroupId
  readonly unitId: UnitId

  /** The group this one nests under, or null when it is top level in its unit. */
  readonly parentGroupId: GroupId | null

  readonly name: string
}
