import { exportOpenApi } from './export-openapi.ts'

/** `pnpm --filter @quill/server export-openapi` — see `export-openapi.ts`. */
const result = await exportOpenApi()
process.stdout.write(
  `Wrote ${result.operations} operations across ${result.paths.length} paths to ${result.file}\n`,
)
