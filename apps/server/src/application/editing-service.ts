import type {
  AcquireLockResult,
  DraftRow,
  HeartbeatResult,
  SessionId,
  TakeoverResult,
  WriteDraftResult,
} from '@quill/application'
import type { DocumentId } from '@quill/domain'
import type { FastifyRequest } from 'fastify'

import type { AppDependencies } from '../dependencies.ts'
import { authorizerFor, requireDocumentAccess } from './authorization.ts'

/**
 * Holding and writing a draft (ADR-021), as one application service.
 *
 * It exists for two reasons. Routes call services, not repositories
 * (AGENTS.md rule 3), and — the reason it is worth a file of its own — the
 * lock is not a substitute for a permission check.
 *
 * The old code resolved `edit` when a lock was acquired and never again, on
 * the reasoning that only an editor could have got the lock in the first
 * place. That is true at the moment of acquisition and stops being true the
 * moment a grant is withdrawn: heartbeat extended the lock indefinitely and
 * every draft write was accepted, so somebody whose access had been revoked
 * went on editing until their browser was closed (review finding H4).
 *
 * So `edit` is re-resolved on every heartbeat and every draft write. It costs
 * one scope-chain walk per fifteen seconds per editor, which is the price of
 * a revocation taking effect. And a holder who has lost the capability does
 * not merely get a `403`: their lock is released on the way out, so the
 * document is immediately available to somebody who may still edit it rather
 * than staying locked for a further minute by an editor who no longer exists.
 */
export function createEditingService(deps: AppDependencies) {
  const { locks, drafts } = deps.uow.repos

  async function requireEdit(
    request: FastifyRequest,
    documentId: DocumentId,
    sessionId: SessionId,
  ): Promise<void> {
    try {
      await requireDocumentAccess(authorizerFor(deps, request), documentId, 'edit')
    } catch (error) {
      // Releasing before rethrowing: the lock belonged to a capability that
      // is gone, and release is idempotent (ADR-021), so this is safe even
      // when the refusal was about a document they never held.
      await locks.release({ documentId, sessionId })
      throw error
    }
  }

  return {
    async acquireLock(input: {
      readonly request: FastifyRequest
      readonly documentId: DocumentId
      readonly userId: Parameters<typeof locks.acquire>[0]['userId']
      readonly sessionId: SessionId
    }): Promise<AcquireLockResult> {
      await requireDocumentAccess(authorizerFor(deps, input.request), input.documentId, 'edit')
      return locks.acquire({
        documentId: input.documentId,
        userId: input.userId,
        sessionId: input.sessionId,
        now: deps.clock.now(),
      })
    },

    async heartbeatLock(input: {
      readonly request: FastifyRequest
      readonly documentId: DocumentId
      readonly sessionId: SessionId
    }): Promise<HeartbeatResult> {
      await requireEdit(input.request, input.documentId, input.sessionId)
      return locks.heartbeat({
        documentId: input.documentId,
        sessionId: input.sessionId,
        now: deps.clock.now(),
      })
    },

    /**
     * Unconditional and idempotent — release is the `sendBeacon` target on
     * navigation (ADR-021), and a beacon cannot read a response, so there is
     * no answer a permission check could usefully produce here.
     */
    async releaseLock(input: {
      readonly documentId: DocumentId
      readonly sessionId: SessionId
    }): Promise<void> {
      await locks.release(input)
    },

    async takeoverLock(input: {
      readonly request: FastifyRequest
      readonly documentId: DocumentId
      readonly userId: Parameters<typeof locks.adminTakeover>[0]['userId']
      readonly sessionId: SessionId
    }): Promise<TakeoverResult> {
      // Editors may take an expired lock by acquiring again; taking an active
      // one from its holder is an administrative act (ADR-021).
      await requireDocumentAccess(authorizerFor(deps, input.request), input.documentId, 'manage')
      return locks.adminTakeover({
        documentId: input.documentId,
        userId: input.userId,
        sessionId: input.sessionId,
        now: deps.clock.now(),
      })
    },

    /**
     * A draft is unpublished work, so reading one needs the right to write it,
     * not merely the right to read the document (ADR-021).
     */
    async readDraft(input: {
      readonly request: FastifyRequest
      readonly documentId: DocumentId
    }): Promise<DraftRow | null> {
      await requireDocumentAccess(authorizerFor(deps, input.request), input.documentId, 'edit')
      return drafts.find(input.documentId)
    },

    async writeDraft(input: {
      readonly request: FastifyRequest
      readonly documentId: DocumentId
      readonly sessionId: SessionId
      readonly expectedVersion: number
      readonly ast: unknown
    }): Promise<WriteDraftResult> {
      await requireEdit(input.request, input.documentId, input.sessionId)
      return drafts.write({
        documentId: input.documentId,
        sessionId: input.sessionId,
        expectedVersion: input.expectedVersion,
        ast: input.ast,
        now: deps.clock.now(),
      })
    },
  }
}

export type EditingService = ReturnType<typeof createEditingService>
