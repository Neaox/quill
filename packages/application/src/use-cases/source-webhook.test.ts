import { BRAND } from '@quill/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import { userId, workspaceId } from '@quill/domain'

import type { MessageAuthenticator } from '../ports/system.ts'
import { createFakeSecretCipher } from '../test-support/fake-secret-cipher.ts'
import type { FakeSecretCipher } from '../test-support/fake-secret-cipher.ts'
import {
  createFakeClock,
  createFakeIdGenerator,
  createFakeTokenService,
} from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { SOURCE_SYNC_REQUESTED } from './events.ts'
import { setSecret } from './secrets.ts'
import {
  MAX_DELIVERY_ID_LENGTH,
  SOURCE_WEBHOOK_DELIVERY_RETENTION_MS,
  receiveSourceWebhook,
  sweepSourceWebhookDeliveries,
} from './source-webhook.ts'
import type { SourceWebhookDelivery, SourceWebhookDependencies } from './source-webhook.ts'

const NOW = new Date('2026-11-09T12:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const NATIVE = workspaceId('00000000-0000-4000-8000-000000000102')
const ACTOR = userId('00000000-0000-4000-8000-000000000001')
const SECRET_NAME = 'sources/handbook-webhook'
const SECRET = 'shared-webhook-secret'
/** The key a delivery is checked against when there is no secret. */
const NO_SECRET = `${BRAND.slug}:no-webhook-secret`

/** Not HMAC, but a function of exactly what HMAC is a function of. */
const authenticator: MessageAuthenticator = {
  hmacSha256: (key, message) => `hmac(${key}):${new TextDecoder().decode(message)}`,
}

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

let uow: InMemoryUnitOfWork
let cipher: FakeSecretCipher
let deps: SourceWebhookDependencies

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  cipher = createFakeSecretCipher()
  deps = {
    uow,
    secrets: cipher,
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
    tokens: createFakeTokenService(),
    authenticator,
  }
  for (const [id, slug] of [
    [WORKSPACE, 'handbook'],
    [NATIVE, 'native'],
  ] as const) {
    await uow.repos.workspaces.create({ id, unitId: 'acme', name: slug, slug, now: NOW })
  }
  await setSecret(deps, { name: SECRET_NAME, value: SECRET, actor: ACTOR })
  await putSource(SECRET_NAME)
})

async function putSource(webhookSecretName: string | null) {
  await uow.repos.workspaceSources.put({
    workspaceId: WORKSPACE,
    remote: 'https://github.com/acme/handbook.git',
    branch: 'main',
    collections: [],
    history: 'full',
    commitMessages: 'subject',
    manifestEntry: null,
    credential: null,
    webhookSecretName,
    outsideLinks: 'forge',
    viewTemplate: null,
    configuredBy: ACTOR,
    now: NOW,
  })
}

/** A GitHub push to `ref`, signed with `key`. */
function github(
  options: {
    readonly key?: string
    readonly ref?: string
    readonly event?: string
    readonly delivery?: string | undefined
    readonly body?: Uint8Array
    readonly workspace?: string
  } = {},
): SourceWebhookDelivery {
  const body = options.body ?? encode({ ref: options.ref ?? 'refs/heads/main', after: 'abc' })
  return {
    workspaceId: options.workspace ?? WORKSPACE,
    forge: 'github',
    headers: {
      'x-hub-signature-256': `sha256=${authenticator.hmacSha256(options.key ?? SECRET, body)}`,
      'x-github-event': options.event ?? 'push',
      'x-github-delivery': 'delivery' in options ? options.delivery : 'd-1',
    },
    body,
  }
}

const requested = () => uow.events.filter((event) => event.type === SOURCE_SYNC_REQUESTED)

describe('receiveSourceWebhook: GitHub', () => {
  it('asks for a sync on a signed push to the branch', async () => {
    expect(await receiveSourceWebhook(deps, github())).toEqual({ kind: 'requested' })
    expect(requested().map(({ payload }) => payload)).toEqual([
      { version: 1, workspaceId: WORKSPACE, trigger: 'webhook' },
    ])
  })

  it('accepts a delivery once, however often the forge retries it', async () => {
    await receiveSourceWebhook(deps, github())
    expect(await receiveSourceWebhook(deps, github())).toEqual({ kind: 'duplicate' })
    expect(requested()).toHaveLength(1)
    expect(await receiveSourceWebhook(deps, github({ delivery: 'd-2' }))).toEqual({
      kind: 'requested',
    })
  })

  it('refuses every unverifiable delivery with one answer', async () => {
    const refused = { kind: 'refused' }
    // A wrong secret, and no signature at all.
    expect(await receiveSourceWebhook(deps, github({ key: 'guess' }))).toEqual(refused)
    const unsigned = github()
    expect(
      await receiveSourceWebhook(deps, {
        ...unsigned,
        headers: { ...unsigned.headers, 'x-hub-signature-256': undefined },
      }),
    ).toEqual(refused)
    // A body that is not the one signed.
    expect(
      await receiveSourceWebhook(deps, { ...github(), body: encode({ ref: 'refs/heads/main' }) }),
    ).toEqual(refused)
    // A workspace that does not exist, and one that reads from no source, even
    // when the delivery is signed with the key a missing secret is checked against.
    for (const workspace of ['nope', NATIVE]) {
      expect(await receiveSourceWebhook(deps, github({ workspace }))).toEqual(refused)
      expect(await receiveSourceWebhook(deps, github({ workspace, key: NO_SECRET }))).toEqual(
        refused,
      )
    }
    expect(requested()).toEqual([])
  })

  it('refuses a source that takes no webhook, or whose secret is gone or does not open', async () => {
    await putSource(null)
    expect(await receiveSourceWebhook(deps, github({ key: NO_SECRET }))).toEqual({
      kind: 'refused',
    })
    await putSource('sources/missing')
    expect(await receiveSourceWebhook(deps, github())).toEqual({ kind: 'refused' })
    await putSource(SECRET_NAME)
    cipher.rotateTo('key-2')
    cipher.forget('key-1')
    expect(await receiveSourceWebhook(deps, github())).toEqual({ kind: 'refused' })
  })

  it('ignores other events and other branches', async () => {
    expect(await receiveSourceWebhook(deps, github({ event: 'ping' }))).toEqual({
      kind: 'ignored',
      reason: 'event',
    })
    for (const ref of ['refs/heads/release', 'refs/tags/main', 'refs/heads/main/x']) {
      expect(await receiveSourceWebhook(deps, github({ ref }))).toEqual({
        kind: 'ignored',
        reason: 'branch',
      })
    }
    expect(requested()).toEqual([])
  })

  it.each([
    ['no delivery id', { delivery: undefined }],
    ['an empty delivery id', { delivery: '' }],
    ['a delivery id too long', { delivery: 'x'.repeat(MAX_DELIVERY_ID_LENGTH + 1) }],
    ['a body that is not JSON', { body: new TextEncoder().encode('ref=refs/heads/main') }],
    ['a body that is not UTF-8', { body: new Uint8Array([0xff, 0xfe]) }],
    ['a body that is not an object', { body: encode(null) }],
    ['a payload with no ref', { body: encode({ after: 'abc' }) }],
  ])('answers malformed for a signed push with %s', async (_, options) => {
    expect(await receiveSourceWebhook(deps, github(options))).toEqual({ kind: 'malformed' })
    expect(requested()).toEqual([])
  })
})

describe('receiveSourceWebhook: GitLab', () => {
  function gitlab(headers: Record<string, string | undefined>): SourceWebhookDelivery {
    return {
      workspaceId: WORKSPACE,
      forge: 'gitlab',
      headers: { 'x-gitlab-token': SECRET, 'x-gitlab-event': 'Push Hook', ...headers },
      body: encode({ ref: 'refs/heads/main' }),
    }
  }

  it('asks for a sync on a push carrying the secret, keyed by its idempotency key', async () => {
    const delivery = gitlab({ 'idempotency-key': 'k-1', 'x-gitlab-event-uuid': 'u-1' })
    expect(await receiveSourceWebhook(deps, delivery)).toEqual({ kind: 'requested' })
    const retried = gitlab({ 'idempotency-key': 'k-1', 'x-gitlab-event-uuid': 'u-2' })
    expect(await receiveSourceWebhook(deps, retried)).toEqual({ kind: 'duplicate' })
  })

  it('falls back to the event UUID', async () => {
    expect(await receiveSourceWebhook(deps, gitlab({ 'x-gitlab-event-uuid': 'u-1' }))).toEqual({
      kind: 'requested',
    })
  })

  it('refuses a wrong or missing token and ignores other events', async () => {
    expect(await receiveSourceWebhook(deps, gitlab({ 'x-gitlab-token': 'guess' }))).toEqual({
      kind: 'refused',
    })
    expect(await receiveSourceWebhook(deps, gitlab({ 'x-gitlab-token': undefined }))).toEqual({
      kind: 'refused',
    })
    expect(
      await receiveSourceWebhook(
        deps,
        gitlab({ 'x-gitlab-event': 'Tag Push Hook', 'x-gitlab-event-uuid': 'u-1' }),
      ),
    ).toEqual({ kind: 'ignored', reason: 'event' })
  })
})

describe('sweepSourceWebhookDeliveries', () => {
  it('forgets deliveries older than a week', async () => {
    await receiveSourceWebhook(deps, github())
    const later = new Date(NOW.getTime() + SOURCE_WEBHOOK_DELIVERY_RETENTION_MS)
    expect(await sweepSourceWebhookDeliveries(deps, later)).toBe(0)
    expect(await sweepSourceWebhookDeliveries(deps, new Date(later.getTime() + 1))).toBe(1)
    expect(await receiveSourceWebhook(deps, github())).toEqual({ kind: 'requested' })
  })
})
