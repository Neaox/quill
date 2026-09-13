import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle Kit config used only to generate SQL migrations from
 * `src/infrastructure/db/schema.ts` into `drizzle/`. The running server
 * never imports this file; `src/infrastructure/db/migrator.ts` applies the
 * generated SQL directly.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/db/schema.ts',
  out: './drizzle',
})
