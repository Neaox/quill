import type { UnitId } from '../ids.ts'

/**
 * A node in the organisational tree.
 *
 * The tree has no fixed depth and every level is named by an administrator, so
 * a deployment can insert a level without a schema change or a rewrite
 * (ADR-012). Units are private to one another: a unit sees nothing of a sibling
 * without an explicit grant.
 */
export interface OrganisationalUnit {
  readonly id: UnitId

  /** The parent unit, or null when the unit sits directly under the instance. */
  readonly parentId: UnitId | null

  readonly name: string
  readonly slug: string

  /** The administrator's noun for this level, such as "company" or "team". */
  readonly label: string
}
