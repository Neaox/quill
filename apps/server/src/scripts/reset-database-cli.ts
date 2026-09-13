import { loadConfig } from '../config.ts'
import { resetDatabase } from './reset-database.ts'

/**
 * `pnpm --filter @quill/server db:reset` — empties the configured database,
 * creating it first if it does not exist, so the next server start migrates
 * it from nothing. For disposable databases: the Playwright run's own
 * (`e2e/support/env.ts`), or a local one an operator names together with
 * `DATABASE_RESET_ALLOW=1`. The refusal below is the only thing between this
 * command and a production database, so it says no under
 * `NODE_ENV=production` even when the name looks disposable.
 */
if (process.env['NODE_ENV'] === 'production') {
  process.stderr.write('Refusing to reset a database under NODE_ENV=production.\n')
  process.exit(1)
}

const config = loadConfig()
const result = await resetDatabase({
  connectionString: config.databaseUrl,
  allow: process.env['DATABASE_RESET_ALLOW'] === '1',
})
process.stdout.write(
  `${result.created ? 'Created' : 'Reset'} database ${result.database}: empty, migrated on the next start.\n`,
)
