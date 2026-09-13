import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'

import type * as schema from './schema.ts'

/**
 * The common surface `Database` (bound to the pool) and a Drizzle
 * transaction (bound to one client, inside `UnitOfWork.run`) both satisfy,
 * so a repository can be written once and used in either context.
 */
export type DrizzleClient = PgDatabase<NodePgQueryResultHKT, typeof schema>
