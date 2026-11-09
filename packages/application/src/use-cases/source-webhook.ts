import { BRAND } from '@quill/brand'
import type { WorkspaceId } from '@quill/domain'

import type { SecretCipher } from '../ports/secrets.ts'
import type { UnitOfWork } from '../ports/persistence.ts'
import type { Clock, IdGenerator, MessageAuthenticator, TokenService } from '../ports/system.ts'
import { sourceSyncRequested } from './events.ts'
import { getSecret } from './secrets.ts'

/**
 * A forge's push webhook for a sourced workspace (ADR-061, "Freshness: one
 * idempotent sync job, three triggers"): the primary way a push reaches Quill.
 *
 * The rules, in the order they are applied:
 *
 * - **The signature comes first.** Nothing in the delivery is read before it
 *   verifies against the source's webhook secret (ADR-034), and the
 *   comparison does not leak where it differs. An unknown workspace, a
 *   native one, a source with no webhook secret, a secret that does not
 *   open and a wrong signature are one answer, `refused`, so the route can
 *   say nothing about which it was.
 * - **Only a push to the source's branch asks for a sync.** Other events
 *   (GitHub's `ping`) and other branches are `ignored`.
 * - **A delivery is accepted once.** Its id is recorded for a week, so a
 *   forge's retry asks for one sync.
 * - **The payload is a hint.** It is never fetched from or believed: the sync
 *   job reads the repository and works out what changed, so a delivery that
 *   is missed, repeated or lies cannot change what is stored.
 *
 * Two forges are read: GitHub (`X-Hub-Signature-256`, an HMAC-SHA-256 of the
 * raw body) and GitLab (`X-Gitlab-Token`, the secret itself). Both send the
 * pushed ref as the payload's `ref`.
 */

export const SOURCE_WEBHOOK_FORGES = ['github', 'gitlab'] as const
export type SourceWebhookForge = (typeof SOURCE_WEBHOOK_FORGES)[number]

/** How long a delivery id is remembered (ADR-061: "a table kept for a week"). */
export const SOURCE_WEBHOOK_DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Longer than any forge's delivery id; anything longer is not one. */
export const MAX_DELIVERY_ID_LENGTH = 200

/**
 * The key a delivery is checked against when there is no secret to check it
 * against, so a refusal costs what a check does whether or not the
 * workspace, its source or its secret exists.
 */
const NO_SECRET = `${BRAND.slug}:no-webhook-secret`

export interface SourceWebhookDependencies {
  readonly uow: UnitOfWork
  readonly secrets: SecretCipher
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly tokens: TokenService
  readonly authenticator: MessageAuthenticator
}

export interface SourceWebhookDelivery {
  /** As the address named it: unchecked, and never echoed. */
  readonly workspaceId: string
  readonly forge: SourceWebhookForge
  /** The request's headers, by lower-case name. */
  readonly headers: Readonly<Record<string, string | undefined>>
  /** The raw body the signature covers. */
  readonly body: Uint8Array
}

export type SourceWebhookResult =
  /** The signature did not verify, or there was nothing to verify it against. */
  | { readonly kind: 'refused' }
  /** Signed, but not a delivery: no delivery id, or a body that is not a JSON object. */
  | { readonly kind: 'malformed' }
  | { readonly kind: 'ignored'; readonly reason: 'event' | 'branch' }
  /** This delivery was accepted before. */
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'requested' }

interface ForgeFormat {
  /** Whether the delivery carries the secret's signature of its body. */
  verify(deps: SourceWebhookDependencies, delivery: SourceWebhookDelivery, key: string): boolean
  isPush(headers: SourceWebhookDelivery['headers']): boolean
  deliveryId(headers: SourceWebhookDelivery['headers']): string | undefined
}

const FORGES: Readonly<Record<SourceWebhookForge, ForgeFormat>> = {
  github: {
    verify(deps, { headers, body }, key) {
      const expected = `sha256=${deps.authenticator.hmacSha256(key, body)}`
      return deps.tokens.matches(expected, headers['x-hub-signature-256'] ?? '')
    },
    isPush: (headers) => headers['x-github-event'] === 'push',
    deliveryId: (headers) => headers['x-github-delivery'],
  },
  gitlab: {
    // GitLab sends the secret itself; both sides are hashed first so the
    // comparison is between equal lengths and leaks nothing about either.
    verify(deps, { headers }, key) {
      return deps.tokens.matches(
        deps.tokens.hash(key),
        deps.tokens.hash(headers['x-gitlab-token'] ?? ''),
      )
    },
    isPush: (headers) => headers['x-gitlab-event'] === 'Push Hook',
    // `Idempotency-Key` stays the same across GitLab's retries of one
    // delivery (GitLab 17.4 and later); the event UUID is the fallback.
    deliveryId: (headers) => headers['idempotency-key'] ?? headers['x-gitlab-event-uuid'],
  },
}

export async function receiveSourceWebhook(
  deps: SourceWebhookDependencies,
  delivery: SourceWebhookDelivery,
): Promise<SourceWebhookResult> {
  const workspaceId = delivery.workspaceId as WorkspaceId
  const source = await deps.uow.repos.workspaceSources.find(workspaceId)
  const secretName = source?.webhookSecretName ?? null
  const secret = secretName === null ? null : await getSecret(deps, secretName)
  const key = secret?.kind === 'secret' ? secret.value : null
  const format = FORGES[delivery.forge]
  // Checked even when it cannot pass, so a refusal takes as long either way.
  const verified = format.verify(deps, delivery, key ?? NO_SECRET)
  if (!verified || key === null || source === null) return { kind: 'refused' }

  if (!format.isPush(delivery.headers)) return { kind: 'ignored', reason: 'event' }
  const deliveryId = format.deliveryId(delivery.headers)
  const ref = pushedRef(delivery.body)
  if (
    deliveryId === undefined ||
    deliveryId.length === 0 ||
    deliveryId.length > MAX_DELIVERY_ID_LENGTH ||
    ref === null
  ) {
    return { kind: 'malformed' }
  }
  if (ref !== `refs/heads/${source.branch}`) return { kind: 'ignored', reason: 'branch' }

  const now = deps.clock.now()
  return await deps.uow.run(async (tx) => {
    const fresh = await tx.sourceWebhookDeliveries.record({ workspaceId, deliveryId, now })
    if (!fresh) return { kind: 'duplicate' }
    await tx.events.record(sourceSyncRequested, { workspaceId, trigger: 'webhook' }, now)
    return { kind: 'requested' }
  })
}

/** The payload's `ref`, or null when the body is not a JSON object with one. */
function pushedRef(body: Uint8Array): string | null {
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null
  const ref: unknown = (payload as Record<string, unknown>)['ref']
  return typeof ref === 'string' ? ref : null
}

/** Forgets delivery ids older than a week, for the housekeeping job. */
export function sweepSourceWebhookDeliveries(
  deps: { readonly uow: UnitOfWork },
  now: Date,
): Promise<number> {
  return deps.uow.repos.sourceWebhookDeliveries.deleteReceivedBefore(
    new Date(now.getTime() - SOURCE_WEBHOOK_DELIVERY_RETENTION_MS),
  )
}
