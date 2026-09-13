import { and, eq, isNull, or, type SQL } from 'drizzle-orm'

import type {
  CreateGrantInput,
  IdGenerator,
  GrantEffect,
  GrantId,
  GrantRepository,
  GrantRow,
  PrincipalKind,
  ScopeKind,
} from '@quill/application'
import type { Role, UserId } from '@quill/domain'

import { grants, principals } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

/**
 * How many scope selectors travel in one statement.
 *
 * PostgreSQL's wire protocol allows 65,535 bound parameters per statement and
 * each selector spends two of them, so 16,000 leaves room to spare and keeps
 * the number of round trips low for the sizes that actually occur.
 */
const SCOPES_PER_QUERY = 16_000

interface PrincipalRow {
  id: string
  kind: PrincipalKind
  refId: string | null
}

/**
 * `principals` is an implementation detail of this repository: the port
 * only ever speaks `(principalKind, principalId)`, never the synthetic join
 * row `grants.principal_id` references. That synthetic id still comes from
 * the injected `IdGenerator` rather than the system's, so a test controls
 * it like every other id the platform mints.
 */
async function ensurePrincipal(
  db: DrizzleClient,
  ids: IdGenerator,
  kind: PrincipalKind,
  refId: string | null,
  now: Date,
): Promise<string> {
  const condition =
    refId === null
      ? and(eq(principals.kind, kind), isNull(principals.refId))
      : and(eq(principals.kind, kind), eq(principals.refId, refId))
  const existing = await db.select().from(principals).where(condition)
  const found = existing[0]
  if (found !== undefined) {
    return found.id
  }
  const inserted = await db
    .insert(principals)
    .values({ id: ids.uuid(), kind, refId, createdAt: now })
    .onConflictDoNothing({ target: [principals.kind, principals.refId] })
    .returning()
  const insertedRow = inserted[0]
  if (insertedRow !== undefined) {
    return insertedRow.id
  }
  // Lost a race with a concurrent insert of the same (kind, refId); re-read.
  const raceWinner = await db.select().from(principals).where(condition)
  return requireRow(
    raceWinner[0],
    'ensurePrincipal: expected a principal row after a conflicting insert',
  ).id
}

function toGrantRow(row: typeof grants.$inferSelect, principal: PrincipalRow): GrantRow {
  return {
    id: row.id as GrantId,
    principalKind: principal.kind,
    principalId: principal.refId,
    scopeKind: row.scopeKind as ScopeKind,
    scopeId: row.scopeId,
    role: row.role as Role,
    effect: row.effect as GrantEffect,
    createdBy: row.createdBy as UserId | null,
    createdAt: row.createdAt,
  }
}

export function createGrantRepository(db: DrizzleClient, ids: IdGenerator): GrantRepository {
  return {
    async create(input: CreateGrantInput): Promise<GrantRow> {
      const principalId = await ensurePrincipal(
        db,
        ids,
        input.principalKind,
        input.principalId,
        input.now,
      )
      const rows = await db
        .insert(grants)
        .values({
          id: input.id,
          principalId,
          // Materialised beside the reference so the "public is never an
          // owner" check constraint can see it: a check cannot read the
          // `principals` table (see `db/schema.ts`).
          principalKind: input.principalKind,
          scopeKind: input.scopeKind,
          scopeId: input.scopeId,
          role: input.role,
          effect: input.effect,
          createdBy: input.createdBy,
          createdAt: input.now,
        })
        .returning()
      return toGrantRow(requireRow(rows[0], 'create: expected the inserted grant row back'), {
        id: principalId,
        kind: input.principalKind,
        refId: input.principalId,
      })
    },

    async delete(id: GrantId): Promise<void> {
      await db.delete(grants).where(eq(grants.id, id))
    },

    async listForScope(scopeKind: ScopeKind, scopeId: string | null): Promise<readonly GrantRow[]> {
      const condition =
        scopeId === null
          ? and(eq(grants.scopeKind, scopeKind), isNull(grants.scopeId))
          : and(eq(grants.scopeKind, scopeKind), eq(grants.scopeId, scopeId))
      const rows = await db
        .select({ grant: grants, principal: principals })
        .from(grants)
        .innerJoin(principals, eq(grants.principalId, principals.id))
        .where(condition)
      return rows.map(({ grant, principal }) =>
        toGrantRow(grant, {
          id: principal.id,
          kind: principal.kind as PrincipalKind,
          refId: principal.refId,
        }),
      )
    },

    /**
     * Every grant on a whole scope chain, in as few queries as the wire
     * protocol allows: resolution reads the document, its ancestors, its
     * collection, its workspace, its units, and the instance, and must not pay
     * a round trip per level.
     *
     * "As few as the protocol allows" and not "one", because materialising a
     * workspace's permissions asks about every document in it at once
     * (`visibleDocumentIds`), and each scope costs two bound parameters
     * against a hard ceiling of 65,535 per statement. A workspace of more than
     * about thirty-three thousand documents used to fail outright — the flat
     * document list as surely as search — so the selectors are asked in
     * chunks and the answers concatenated. A grant matches at most one scope,
     * so no row can come back twice.
     */
    async listForScopes(scopes): Promise<readonly GrantRow[]> {
      if (scopes.length === 0) return []

      const rows: {
        grant: typeof grants.$inferSelect
        principal: typeof principals.$inferSelect
      }[] = []
      for (let from = 0; from < scopes.length; from += SCOPES_PER_QUERY) {
        const conditions = scopes
          .slice(from, from + SCOPES_PER_QUERY)
          .map((scope): SQL | undefined =>
            scope.id === null
              ? and(eq(grants.scopeKind, scope.kind), isNull(grants.scopeId))
              : and(eq(grants.scopeKind, scope.kind), eq(grants.scopeId, scope.id)),
          )
        rows.push(
          ...(await db
            .select({ grant: grants, principal: principals })
            .from(grants)
            .innerJoin(principals, eq(grants.principalId, principals.id))
            .where(or(...conditions))),
        )
      }

      return rows.map(({ grant, principal }) =>
        toGrantRow(grant, {
          id: principal.id,
          kind: principal.kind as PrincipalKind,
          refId: principal.refId,
        }),
      )
    },

    async listForPrincipal(
      principalKind: PrincipalKind,
      principalId: string | null,
    ): Promise<readonly GrantRow[]> {
      const condition =
        principalId === null
          ? and(eq(principals.kind, principalKind), isNull(principals.refId))
          : and(eq(principals.kind, principalKind), eq(principals.refId, principalId))
      const rows = await db
        .select({ grant: grants, principal: principals })
        .from(grants)
        .innerJoin(principals, eq(grants.principalId, principals.id))
        .where(condition)
      return rows.map(({ grant, principal }) =>
        toGrantRow(grant, {
          id: principal.id,
          kind: principal.kind as PrincipalKind,
          refId: principal.refId,
        }),
      )
    },
  }
}
