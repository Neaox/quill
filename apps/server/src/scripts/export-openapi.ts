import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createFakeClock,
  createFakeIdGenerator,
  createInMemoryBlobStore,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import { createSearchService } from '@quill/search'
import { createInMemorySearchIndex } from '@quill/search/test-support'

import { createShareLinkPolicy } from '../application/share-link-policy.ts'
import { buildApp } from '../app.ts'
import { createHasher } from '../infrastructure/hasher.ts'
import { loadConfig } from '../config.ts'
import type { AppDependencies } from '../dependencies.ts'
import { createIdentityProviderRegistry, outboundClientFactory } from '../auth/oidc/registry.ts'
import { createPasswordHasher } from '../auth/password.ts'
import { createRateLimiter } from '../auth/rate-limit.ts'
import { createTokenService } from '../auth/tokens.ts'
import { createFakeBreachedPasswordChecker, createRecordingMailer } from '../test-support/fakes.ts'
import { createContentStore } from '../infrastructure/content-store.ts'
import { createDocumentFormat } from '../infrastructure/markdown/document-format.ts'
import { createEnvelopeCipher } from '../infrastructure/secrets/envelope-cipher.ts'
import { createKeyProvider } from '../infrastructure/secrets/key-provider.ts'
import { createSecretResolver } from '../infrastructure/secrets/resolve-secret.ts'
import { createSettingsStore } from '../infrastructure/settings-store.ts'

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
  // Describing the API searches nothing, so the core's own in-memory index is
  // the honest choice rather than one bound to a database that is not there.
  const searchIndex = createInMemorySearchIndex()
  const contentStore = createContentStore({ driver: 'memory' }, clock)
  const uow = createInMemoryUnitOfWork()
  // Describing the API encrypts nothing; the development key is present
  // because the routes ask for the port, not because it is used.
  const secrets = createEnvelopeCipher(await createKeyProvider(config.masterKey))
  const ids = createFakeIdGenerator()
  return {
    uow,
    searchIndex,
    search: createSearchService(searchIndex),
    contentStore,
    settings: createSettingsStore(contentStore),
    secrets,
    blobStore: createInMemoryBlobStore(),
    format: createDocumentFormat(),
    clock,
    hasher: createHasher(),
    tokens: createTokenService(),
    shareLinkPolicy: createShareLinkPolicy(config),
    ids,
    // Describing the API sends no mail, so the recording mailer is the
    // honest choice rather than one configured to reach a server.
    mailer: createRecordingMailer(),
    // Describing the API checks no password and limits nothing; both ports
    // are present because the routes ask for them, not because they run.
    breachedPasswords: createFakeBreachedPasswordChecker(),
    rateLimiter: createRateLimiter({ clock, config: config.rateLimit }),
    oidcRateLimiter: createRateLimiter({ clock, config: config.oidcRateLimit }),
    attachmentRateLimiter: createRateLimiter({ clock, config: config.attachments.rateLimit }),
    passwords: await createPasswordHasher(),
    // Describing the API talks to no provider; the registry is present
    // because the routes read it at registration, and it is empty.
    identityProviders: createIdentityProviderRegistry({
      providers: config.oidcProviders,
      appUrl: config.appUrl,
      createClient: outboundClientFactory,
      clock,
      secretResolver: createSecretResolver({ uow, secrets, clock, ids }),
    }),
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
