import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeClock, createFakeIdGenerator } from '@quill/application/test-support'
import { createInMemoryUnitOfWork } from '@quill/application/test-support'

import { buildApp } from '../app.ts'
import { createHasher } from '../infrastructure/hasher.ts'
import { loadConfig } from '../config.ts'
import type { AppDependencies } from '../dependencies.ts'
import { createPasswordHasher } from '../auth/password.ts'
import { createRateLimiter } from '../auth/rate-limit.ts'
import { createFakeBreachedPasswordChecker, createRecordingMailer } from '../test-support/fakes.ts'
import { createContentStore } from '../infrastructure/content-store.ts'
import { createDocumentFormat } from '../infrastructure/markdown/document-format.ts'

/**
 * The OpenAPI description of the API, written from the routes themselves.
 *
 * The description is generated from the TypeBox schemas the routes declare, so
 * it cannot drift from what the server actually accepts and answers, and the
 * web app's client is generated from it in turn (ADR-025). Building the app
 * needs no database: nothing is called, only registered.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_OPENAPI_PATH = path.resolve(
  here,
  '../../../../packages/api-client/openapi.gen.json',
)

export interface OpenApiDocument {
  readonly openapi: string
  readonly paths: Readonly<Record<string, unknown>>
}

/** Every dependency a route needs to register, with nothing behind it. */
async function describableDependencies(): Promise<AppDependencies> {
  const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
  const config = loadConfig({ CONTENT_STORE: 'memory' })
  return {
    uow: createInMemoryUnitOfWork(),
    contentStore: createContentStore({ driver: 'memory' }, clock),
    format: createDocumentFormat(),
    clock,
    hasher: createHasher(),
    ids: createFakeIdGenerator(),
    // Describing the API sends no mail, so the recording mailer is the
    // honest choice rather than one configured to reach a server.
    mailer: createRecordingMailer(),
    // Describing the API checks no password and limits nothing; both ports
    // are present because the routes ask for them, not because they run.
    breachedPasswords: createFakeBreachedPasswordChecker(),
    rateLimiter: createRateLimiter({ clock, config: config.rateLimit }),
    passwords: await createPasswordHasher(),
    config,
  }
}

export async function buildOpenApiDocument(): Promise<OpenApiDocument> {
  const app = buildApp({
    logLevel: 'silent',
    deps: await describableDependencies(),
    serveApiDocs: false,
  })
  try {
    await app.ready()
    return app.swagger() as unknown as OpenApiDocument
  } finally {
    await app.close()
  }
}

export interface ExportResult {
  readonly file: string
  readonly operations: number
  readonly paths: readonly string[]
}

export async function exportOpenApi(file: string = DEFAULT_OPENAPI_PATH): Promise<ExportResult> {
  const description = await buildOpenApiDocument()
  await writeFile(file, `${JSON.stringify(description, null, 2)}\n`, 'utf8')
  return {
    file,
    operations: countOperations(description),
    paths: Object.keys(description.paths),
  }
}

const METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'])

export function countOperations(description: OpenApiDocument): number {
  return Object.values(description.paths).reduce<number>(
    (total, operations) =>
      total +
      Object.keys(operations as Record<string, unknown>).filter((key) => METHODS.has(key)).length,
    0,
  )
}
