import { DOCUMENT_STATUSES, principalKey, rankSuggestions, suggestion } from '@quill/domain'
import type { Principal, SearchSuggestion, WorkspaceId } from '@quill/domain'

import type { SearchIndex, VisibilityFilter } from '../ports/index.ts'
import type { UnitOfWork, UnitRow } from '../ports/persistence.ts'
import type { VisibleWorkspace } from './list-visible-workspaces.ts'

/**
 * Completing the value of a search filter as somebody types it (ADR-010,
 * amendment of 2026-10-17): `by:` and `team:` and `tag:` and `collection:` and
 * `in:` and `status:`.
 *
 * A suggestion is a search result with the document left off, so it obeys the
 * rule a search does: it is drawn only from what the caller may already read,
 * and a name or a tag that appears only on a document they are denied is never
 * offered. Where each field comes from decides how that is kept:
 *
 * - `by` and `tag` are in the index, and the index applies the same
 *   {@link VisibilityFilter} a search does, inside its query.
 * - `in` and `collection` are the workspaces the caller may read (the picker's
 *   own answer) and the collections inside them.
 * - `team` is a unit or a group by name, and units are private to one another
 *   (ADR-012): only the units that are the unit of a workspace the caller may
 *   read, or above one, are offered, together with their groups. Somebody who
 *   can read nothing cannot enumerate how the organisation is built.
 * - `status` is the fixed set of statuses a document has.
 *
 * Only names are ever returned: never an address, and never an id.
 *
 * Pattern: a use case as a command (`docs/architecture/patterns.md`), pure of
 * HTTP. The caller resolves who is asking and which workspaces they may read,
 * as search does, and hands both in.
 */

export type SuggestionField = 'by' | 'team' | 'tag' | 'collection' | 'in' | 'status'

export interface SuggestSearchValuesDependencies {
  readonly uow: UnitOfWork
  readonly searchIndex: SearchIndex
}

export interface SuggestSearchValuesCommand {
  readonly field: SuggestionField
  /** Matched as a case-insensitive substring of the label; empty offers everything. */
  readonly prefix: string
  readonly limit: number
  /** Every principal the request holds, from `Authorizer.identities()`. */
  readonly identities: readonly Principal[]
  /** The workspaces the caller may read, from `listVisibleWorkspaces`. */
  readonly readable: readonly VisibleWorkspace[]
  /**
   * The workspace the caller is in, which must be one of `readable`. It only
   * decides which workspace the index looks in first (`by` and `tag`), so the
   * values from where the caller is working are found before the limit is
   * spent; it never changes what may be offered.
   */
  readonly currentWorkspaceId?: WorkspaceId
}

export async function suggestSearchValues(
  deps: SuggestSearchValuesDependencies,
  command: SuggestSearchValuesCommand,
): Promise<readonly SearchSuggestion[]> {
  const { field, prefix, limit } = command
  switch (field) {
    case 'status':
      return rankSuggestions(DOCUMENT_STATUSES.map(suggestion), prefix, limit)
    case 'in':
      return rankSuggestions(
        command.readable.map((visible) => suggestion(visible.workspace.name)),
        prefix,
        limit,
      )
    case 'collection':
      return rankSuggestions(await collectionNames(deps, command), prefix, limit)
    case 'team':
      return rankSuggestions(await teamNames(deps, command), prefix, limit)
    case 'by':
    case 'tag':
      return indexedValues(deps, command, field)
  }
}

async function collectionNames(
  deps: SuggestSearchValuesDependencies,
  command: SuggestSearchValuesCommand,
): Promise<readonly SearchSuggestion[]> {
  if (command.readable.length === 0) return []
  const collections = await deps.uow.repos.collections.listByWorkspaces(
    command.readable.map((visible) => visible.workspace.id),
  )
  return collections.map((collection) => suggestion(collection.name))
}

/**
 * Units that are the unit of a readable workspace or above one, and every
 * group of those units. One ancestor walk per distinct owning unit, run
 * concurrently (as `listVisibleWorkspaces` does), and one read for all the
 * groups.
 */
async function teamNames(
  deps: SuggestSearchValuesDependencies,
  command: SuggestSearchValuesCommand,
): Promise<readonly SearchSuggestion[]> {
  const owningUnits = new Set(command.readable.map((visible) => visible.unit.id))
  if (owningUnits.size === 0) return []

  const chains = await Promise.all(
    [...owningUnits].map((unitId) => deps.uow.repos.units.listAncestors(unitId)),
  )
  const units: ReadonlyMap<string, UnitRow> = new Map(chains.flat().map((unit) => [unit.id, unit]))
  const groups = await deps.uow.repos.groups.listByUnits([...units.keys()])

  return [...units.values(), ...groups].map((team) => suggestion(team.name))
}

async function indexedValues(
  deps: SuggestSearchValuesDependencies,
  command: SuggestSearchValuesCommand,
  field: 'by' | 'tag',
): Promise<readonly SearchSuggestion[]> {
  if (command.readable.length === 0) return []
  const values = await deps.searchIndex.suggest(
    {
      field,
      prefix: command.prefix,
      limit: command.limit,
      ...(command.currentWorkspaceId === undefined
        ? {}
        : { currentWorkspaceId: command.currentWorkspaceId }),
    },
    visibilityOf(command),
  )
  return values.map(suggestion)
}

function visibilityOf(command: SuggestSearchValuesCommand): VisibilityFilter {
  return {
    workspaceIds: command.readable.map((visible) => visible.workspace.id),
    principalKeys: [...new Set(command.identities.map(principalKey))],
  }
}
