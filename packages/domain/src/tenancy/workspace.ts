import type { UnitId, WorkspaceId } from '../ids.ts'

/** A body of documentation belonging to exactly one organisational unit. */
export interface Workspace {
  readonly id: WorkspaceId
  readonly unitId: UnitId
  readonly name: string
  readonly slug: string
}
