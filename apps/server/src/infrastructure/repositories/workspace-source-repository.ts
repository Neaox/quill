import { eq } from 'drizzle-orm'

import type {
  SourceCollection,
  WorkspaceSourceRepository,
  WorkspaceSourceRow,
} from '@quill/application'
import { SOURCE_COMMIT_MESSAGE_SETTINGS, SOURCE_HISTORY_SETTINGS } from '@quill/domain'
import type { UserId, WorkspaceId } from '@quill/domain'

import { requireRow } from '../db/rows.ts'
import { workspaceSources } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

/**
 * Where each sourced workspace reads from (ADR-061). The settings are the
 * administrator's, so they are a row in Postgres rather than a file in the
 * content store (ADR-034), and the credential is held as the name of a secret.
 */

/** The version of the `collections` document, so a later release can read it (ADR-033). */
const COLLECTIONS_VERSION = 1

export function createWorkspaceSourceRepository(db: DrizzleClient): WorkspaceSourceRepository {
  return {
    async find(workspaceId: WorkspaceId): Promise<WorkspaceSourceRow | null> {
      const rows = await db
        .select()
        .from(workspaceSources)
        .where(eq(workspaceSources.workspaceId, workspaceId))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toRow(row)
    },

    async put({ now, collections, credential, ...input }): Promise<WorkspaceSourceRow> {
      const values = {
        remote: input.remote,
        branch: input.branch,
        collections: { version: COLLECTIONS_VERSION, collections },
        history: input.history,
        commitMessages: input.commitMessages,
        credentialUsername: credential?.username ?? null,
        credentialSecret: credential?.secretName ?? null,
        configuredBy: input.configuredBy,
        updatedAt: now,
      }
      const rows = await db
        .insert(workspaceSources)
        .values({ workspaceId: input.workspaceId, createdAt: now, ...values })
        .onConflictDoUpdate({ target: workspaceSources.workspaceId, set: values })
        .returning()
      return toRow(requireRow(rows[0], 'put: expected the workspace source row back'))
    },
  }
}

function toRow(row: typeof workspaceSources.$inferSelect): WorkspaceSourceRow {
  return {
    workspaceId: row.workspaceId as WorkspaceId,
    remote: row.remote,
    branch: row.branch,
    collections: readCollections(row.collections),
    // The table's checks hold these to the settings this release knows.
    history: member(SOURCE_HISTORY_SETTINGS, row.history),
    commitMessages: member(SOURCE_COMMIT_MESSAGE_SETTINGS, row.commitMessages),
    credential:
      row.credentialUsername === null || row.credentialSecret === null
        ? null
        : { username: row.credentialUsername, secretName: row.credentialSecret },
    configuredBy: row.configuredBy as UserId | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function member<T extends string>(allowed: readonly T[], value: string): T {
  const found = allowed.find((candidate) => candidate === value)
  if (found === undefined) throw new Error(`workspace_sources holds an unknown setting "${value}"`)
  return found
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The stored collections. A document this release cannot read is a defect or
 * a downgrade, and syncing with no collections would archive every document,
 * so it is refused rather than read as empty.
 */
function readCollections(value: unknown): readonly SourceCollection[] {
  if (
    isRecord(value) &&
    value['version'] === COLLECTIONS_VERSION &&
    Array.isArray(value['collections'])
  ) {
    const collections = value['collections'].filter(
      (entry): entry is SourceCollection =>
        isRecord(entry) &&
        typeof entry['collectionId'] === 'string' &&
        typeof entry['path'] === 'string',
    )
    if (collections.length === value['collections'].length) {
      return collections.map(({ collectionId, path }) => ({ collectionId, path }))
    }
  }
  throw new Error('workspace_sources holds collections this release cannot read')
}
