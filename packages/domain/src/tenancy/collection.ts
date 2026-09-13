import type { CollectionId, WorkspaceId } from '../ids.ts'

/**
 * A first-level container inside a workspace.
 *
 * Collections carry their own grants and publish settings, which is why they
 * are a permission scope of their own rather than an ordinary folder (ADR-012).
 */
export interface Collection {
  readonly id: CollectionId
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly slug: string
}
