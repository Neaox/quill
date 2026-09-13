import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../app.ts'
import { createHasher } from '../infrastructure/hasher.ts'
import { createDocumentFormat } from '../infrastructure/markdown/document-format.ts'
import { createTokenService } from '../auth/tokens.ts'
import { loadConfig } from '../config.ts'
import type { AppDependencies } from '../dependencies.ts'
import { createTestDatabase, type TestDatabase } from '../infrastructure/db/test-database.ts'
import { createSearchService } from '@quill/search'
import { createInMemorySearchIndex } from '@quill/search/test-support'

import { createUnitOfWork } from '../infrastructure/repositories/unit-of-work.ts'
import { createPasswordHasher } from '../auth/password.ts'
import { createIdentityProviderRegistry, outboundClientFactory } from '../auth/oidc/registry.ts'
import type { SecretResolver } from '../infrastructure/secrets/resolve-secret.ts'
import { createRateLimiter } from '../auth/rate-limit.ts'
import { generateSessionToken, hashSessionToken } from '../auth/session-token.ts'
import { injectAsBrowser } from '../test-support/browser-client.ts'
import {
  createFakeBreachedPasswordChecker,
  createFakeClock,
  createFakeIdGenerator,
  createInMemoryBlobStore,
  createRecordingMailer,
  inMemorySettings,
} from '../test-support/fakes.ts'

/** Nothing in these tests searches; the engine is present because `AppDependencies` is one shape. */
const SEARCH_INDEX = createInMemorySearchIndex()

/** No test in this file configures a provider, so nothing here ever resolves a secret. */
const UNUSED_SECRET_RESOLVER: SecretResolver = {
  async resolve() {
    throw new Error('not exercised: no OIDC provider is configured in this file')
  },
}

let database: TestDatabase
let app: FastifyInstance
let deps: AppDependencies

const ADMIN = userId('00000000-0000-4000-8000-00000000a001')
const MEMBER = userId('00000000-0000-4000-8000-00000000a002')
/** Signed in, but has never confirmed the address (ADR-011, review finding 12). */
const UNVERIFIED = userId('00000000-0000-4000-8000-00000000a003')
const NOW = new Date('2026-01-01T00:00:00.000Z')

async function sessionCookieFor(id: ReturnType<typeof userId>): Promise<string> {
  const token = generateSessionToken()
  await deps.uow.repos.sessions.create({
    id: `session-${id}`,
    userId: id,
    tokenHash: hashSessionToken(token),
    now: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
  })
  return token
}

beforeAll(async () => {
  database = await createTestDatabase()
  const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
  const config = loadConfig({ CONTENT_STORE: 'memory' })
  deps = {
    uow: createUnitOfWork(database.db, database.pool, createFakeIdGenerator()),
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
    hasher: createHasher(),
    tokens: createTokenService(),
    shareLinkPolicy: { allowed: () => true },
    ...(await inMemorySettings(clock, config)),
    blobStore: createInMemoryBlobStore(),
    format: createDocumentFormat(),
    searchIndex: SEARCH_INDEX,
    search: createSearchService(SEARCH_INDEX),
    mailer: createRecordingMailer(),
    breachedPasswords: createFakeBreachedPasswordChecker(),
    rateLimiter: createRateLimiter({ clock, config: config.rateLimit }),
    oidcRateLimiter: createRateLimiter({ clock, config: config.oidcRateLimit }),
    attachmentRateLimiter: createRateLimiter({ clock, config: config.attachments.rateLimit }),
    passwords: await createPasswordHasher(),
    identityProviders: createIdentityProviderRegistry({
      providers: config.oidcProviders,
      appUrl: config.appUrl,
      createClient: outboundClientFactory,
      clock,
      secretResolver: UNUSED_SECRET_RESOLVER,
    }),
    config,
  }
  app = buildApp({ logLevel: 'silent', deps, serveApiDocs: false })
  injectAsBrowser(app)
  await app.ready()

  await deps.uow.repos.users.create({
    id: ADMIN,
    email: 'admin@example.com',
    displayName: 'Admin',
    now: NOW,
  })
  await deps.uow.repos.users.setInstanceAdmin(ADMIN, true)
  await deps.uow.repos.users.markEmailVerified(ADMIN, NOW)
  await deps.uow.repos.users.create({
    id: MEMBER,
    email: 'member@example.com',
    displayName: 'Member',
    now: NOW,
  })
  await deps.uow.repos.users.markEmailVerified(MEMBER, NOW)
  await deps.uow.repos.users.create({
    id: UNVERIFIED,
    email: 'unverified@example.com',
    displayName: 'Unverified',
    now: NOW,
  })
  await deps.uow.repos.users.setInstanceAdmin(UNVERIFIED, true)
}, 30_000)

afterAll(async () => {
  await app.close()
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM sessions')
  await database.pool.query('DELETE FROM workspaces')
  await database.pool.query('DELETE FROM organisational_units')
})

function cookieHeader(name: string, value: string): Record<string, string> {
  return { [name]: value }
}

describe('unit routes', () => {
  it('requires a session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/units',
      payload: { name: 'Acme' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('requires instance admin', async () => {
    const cookie = await sessionCookieFor(MEMBER)
    const response = await app.inject({
      method: 'POST',
      url: '/api/units',
      cookies: cookieHeader(deps.config.session.cookieName, cookie),
      payload: { name: 'Acme' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('lets an instance admin create, list, rename, and delete units', async () => {
    const cookie = await sessionCookieFor(ADMIN)
    const headers = cookieHeader(deps.config.session.cookieName, cookie)

    const created = await app.inject({
      method: 'POST',
      url: '/api/units',
      cookies: headers,
      payload: { name: 'Acme' },
    })
    expect(created.statusCode).toBe(201)
    const unit = created.json()

    const listed = await app.inject({ method: 'GET', url: '/api/units', cookies: headers })
    expect(listed.statusCode).toBe(200)

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/units/${unit.id}`,
      cookies: headers,
    })
    expect(fetched.statusCode).toBe(200)
    expect(fetched.json().name).toBe('Acme')

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/units/${unit.id}`,
      cookies: headers,
      payload: { name: 'Acme Corp' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().name).toBe('Acme Corp')

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/units/${unit.id}`,
      cookies: headers,
    })
    expect(deleted.statusCode).toBe(204)

    const missing = await app.inject({
      method: 'GET',
      url: `/api/units/${unit.id}`,
      cookies: headers,
    })
    expect(missing.statusCode).toBe(404)
  })

  it('lists top-level units when parentId is omitted', async () => {
    const cookie = await sessionCookieFor(ADMIN)
    const headers = cookieHeader(deps.config.session.cookieName, cookie)
    await app.inject({
      method: 'POST',
      url: '/api/units',
      cookies: headers,
      payload: { name: 'Acme' },
    })

    const response = await app.inject({ method: 'GET', url: '/api/units', cookies: headers })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(1)
  })
})

describe('workspace routes', () => {
  it('lets an instance admin create a workspace under a unit', async () => {
    const cookie = await sessionCookieFor(ADMIN)
    const headers = cookieHeader(deps.config.session.cookieName, cookie)
    const unit = (
      await app.inject({
        method: 'POST',
        url: '/api/units',
        cookies: headers,
        payload: { name: 'Acme' },
      })
    ).json()

    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: headers,
      payload: { unitId: unit.id, name: 'Engineering', slug: 'engineering' },
    })
    expect(created.statusCode).toBe(201)
    const workspace = created.json()

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}`,
      cookies: headers,
    })
    expect(fetched.statusCode).toBe(200)
  })

  it('rejects workspace creation by a non-instance-admin', async () => {
    const memberCookie = await sessionCookieFor(MEMBER)
    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: cookieHeader(deps.config.session.cookieName, memberCookie),
      payload: { unitId: 'unit-x', name: 'Engineering', slug: 'engineering' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('returns 404 for an unknown workspace', async () => {
    const cookie = await sessionCookieFor(ADMIN)
    const response = await app.inject({
      method: 'GET',
      url: '/api/workspaces/00000000-0000-4000-8000-0000000000ff',
      cookies: cookieHeader(deps.config.session.cookieName, cookie),
    })
    expect(response.statusCode).toBe(404)
  })

  it('lets a workspace admin rename and delete their workspace, but not a mere member', async () => {
    const adminCookie = await sessionCookieFor(ADMIN)
    const adminHeaders = cookieHeader(deps.config.session.cookieName, adminCookie)
    const unit = (
      await app.inject({
        method: 'POST',
        url: '/api/units',
        cookies: adminHeaders,
        payload: { name: 'Acme' },
      })
    ).json()
    const workspace = (
      await app.inject({
        method: 'POST',
        url: '/api/workspaces',
        cookies: adminHeaders,
        payload: { unitId: unit.id, name: 'Engineering', slug: 'engineering-2' },
      })
    ).json()

    const memberCookie = await sessionCookieFor(MEMBER)
    const memberHeaders = cookieHeader(deps.config.session.cookieName, memberCookie)
    const memberRename = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.id}`,
      cookies: memberHeaders,
      payload: { name: 'Nope' },
    })
    expect(memberRename.statusCode).toBe(403)

    // The instance admin is also a workspace admin everywhere (permissions.ts).
    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.id}`,
      cookies: adminHeaders,
      payload: { name: 'Eng' },
    })
    expect(rename.statusCode).toBe(200)

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.id}`,
      cookies: adminHeaders,
    })
    expect(remove.statusCode).toBe(204)
  })
})

/**
 * Review finding 12: `email_verified_at` was tracked and never enforced, so
 * a self-registered account that never confirmed its address could do
 * everything its grants allowed.
 */
describe('email verification', () => {
  it('refuses to let an unverified instance admin create a unit', async () => {
    const token = await sessionCookieFor(UNVERIFIED)
    const response = await app.inject({
      method: 'POST',
      url: '/api/units',
      cookies: cookieHeader(deps.config.session.cookieName, token),
      payload: { name: 'Acme' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('email_not_verified')
  })

  it('still lets that account read its own profile', async () => {
    const token = await sessionCookieFor(UNVERIFIED)
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: cookieHeader(deps.config.session.cookieName, token),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().emailVerified).toBe(false)
  })
})

/**
 * Review finding L6: these were repository calls straight from the route
 * layer, so they wrote no audit row and refused nothing. Both halves are
 * here: the refusals a client has to branch on, and the row each write
 * leaves behind.
 */
describe('reshaping the organisation', () => {
  let adminCookies: Record<string, string>

  beforeEach(async () => {
    adminCookies = { [deps.config.session.cookieName]: await sessionCookieFor(ADMIN) }
  })

  async function createUnit(body: Record<string, unknown>, cookies = adminCookies) {
    return app.inject({ method: 'POST', url: '/api/units', cookies, payload: body })
  }

  async function auditTypes(): Promise<string[]> {
    const { rows } = await database.pool.query<{ type: string }>(
      'SELECT type FROM audit_events ORDER BY created_at, id',
    )
    return rows.map((row) => row.type)
  }

  it('refuses a unit whose parent does not exist', async () => {
    const response = await createUnit({ name: 'Orphan', parentId: 'nope' })
    expect(response.statusCode).toBe(404)
  })

  it('refuses to delete a unit that still holds a workspace or a child', async () => {
    const parent = await createUnit({ name: 'Holds things' })
    const parentId = parent.json().id as string
    await createUnit({ name: 'A child', parentId })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/units/${parentId}`,
      cookies: adminCookies,
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toMatchObject({
      code: 'unit_not_empty',
      details: { units: 1, workspaces: 0 },
    })
  })

  it('refuses a workspace slug another workspace already uses', async () => {
    const unit = await createUnit({ name: 'For workspaces' })
    const unitId = unit.json().id as string
    const first = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: adminCookies,
      payload: { unitId, name: 'Engineering', slug: 'engineering-l6' },
    })
    expect(first.statusCode).toBe(201)

    const second = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: adminCookies,
      payload: { unitId, name: 'Engineering again', slug: 'engineering-l6' },
    })
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('workspace_slug_taken')
  })

  it('refuses a workspace under a unit that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: adminCookies,
      payload: { unitId: 'nope', name: 'Nowhere', slug: 'nowhere-l6' },
    })
    expect(response.statusCode).toBe(404)
  })

  it('writes an audit row for every unit and workspace change', async () => {
    await database.pool.query('DELETE FROM audit_events')
    const unit = await createUnit({ name: 'Audited' })
    const unitId = unit.json().id as string
    await app.inject({
      method: 'PATCH',
      url: `/api/units/${unitId}`,
      cookies: adminCookies,
      payload: { name: 'Audited, renamed' },
    })
    const workspace = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      cookies: adminCookies,
      payload: { unitId, name: 'Audited workspace', slug: 'audited-workspace' },
    })
    const workspaceId = workspace.json().id as string
    await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspaceId}`,
      cookies: adminCookies,
      payload: { name: 'Audited workspace, renamed' },
    })
    await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspaceId}`,
      cookies: adminCookies,
    })
    await app.inject({ method: 'DELETE', url: `/api/units/${unitId}`, cookies: adminCookies })

    expect(await auditTypes()).toEqual([
      'unit.created',
      'unit.renamed',
      'workspace.created',
      'workspace.renamed',
      'workspace.deleted',
      'unit.deleted',
    ])
  })

  it('answers 404 for renaming or deleting a unit that is not there', async () => {
    for (const request of [
      { method: 'PATCH' as const, url: '/api/units/nope', payload: { name: 'x' } },
      { method: 'DELETE' as const, url: '/api/units/nope' },
    ]) {
      const response = await app.inject({ ...request, cookies: adminCookies })
      expect(response.statusCode).toBe(404)
    }
  })
})
