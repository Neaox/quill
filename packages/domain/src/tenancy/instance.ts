import type { InstanceId } from '../ids.ts'

/**
 * One deployment, serving one organisation.
 *
 * The instance is the root of the organisational unit tree and the least
 * specific permission scope (ADR-012). There is exactly one per deployment;
 * it is an entity rather than a constant so that an instance admin grant,
 * branding, and audit records have something to point at.
 */
export interface Instance {
  readonly id: InstanceId
  readonly name: string
}
