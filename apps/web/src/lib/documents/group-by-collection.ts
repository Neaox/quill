import type { DocumentDto } from '../api/index.ts'

export interface DocumentGroup {
  /** `null` for the synthetic "Uncategorised" group. */
  readonly collectionId: string | null
  readonly label: string
  readonly documents: readonly DocumentDto[]
}

const UNCATEGORISED = Symbol('uncategorised')

/**
 * Groups a workspace's documents by `collectionId`, sorted by label with
 * "Uncategorised" last. Pure and rendering-free so both the navigation tree
 * (`features/workspaces/workspace-navigation.tsx`) and the workspace home
 * page's document list (`features/workspaces/document-list.tsx`) group
 * identically without duplicating the logic (rule 12: an owned utility once
 * the same shape appears three times — this one appears in both those
 * components and is unit-testable on its own here, without rendering).
 *
 * `collectionId` is an opaque id. `GET /workspaces/:id/tree` is the only
 * route that names collections (`docs/architecture/api-contract-m2.md`;
 * there is no `/collections` route), so a caller that has read it passes
 * `names` and a group is labelled the way a person would say it. Without
 * one — a caller that has not, or a collection the tree did not return —
 * the id is the honest label rather than a guess.
 */
export function groupDocumentsByCollection(
  documents: readonly DocumentDto[],
  names: ReadonlyMap<string, string> = new Map(),
  order: readonly string[] = [],
): readonly DocumentGroup[] {
  const groups = Object.groupBy(documents, (document) => document.collectionId ?? UNCATEGORISED)
  const collectionIds = Object.keys(groups).toSorted((a, b) => a.localeCompare(b))
  // The workspace tree's order is the order (`docs/architecture/api-contract-m2.md`):
  // a caller that has read it passes it, and the collections line up with the
  // navigation beside them. Anything the order does not mention keeps the
  // by-name fallback, after everything it does.
  const position = new Map(order.map((collectionId, index) => [collectionId, index]))
  const rank = (collectionId: string) => position.get(collectionId) ?? order.length

  const named: DocumentGroup[] = collectionIds
    .map((collectionId) => ({
      collectionId,
      label: names.get(collectionId) ?? collectionId,
      documents: groups[collectionId] ?? [],
    }))
    .toSorted(
      (a, b) => rank(a.collectionId) - rank(b.collectionId) || a.label.localeCompare(b.label),
    )

  const uncategorised = groups[UNCATEGORISED]
  if (uncategorised === undefined) {
    return named
  }
  return [...named, { collectionId: null, label: 'Uncategorised', documents: uncategorised }]
}
