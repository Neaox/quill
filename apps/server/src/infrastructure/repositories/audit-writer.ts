import type { AuditWriter } from '@quill/application'
import type { UserId } from '@quill/domain'

import { auditEvents } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

export function createAuditWriter(db: DrizzleClient): AuditWriter {
  return {
    async write({ id, type, actorUserId, targetType, targetId, metadata, now }): Promise<void> {
      await db.insert(auditEvents).values({
        id,
        type,
        actorUserId: actorUserId as UserId | null,
        targetType,
        targetId,
        metadata: metadata === undefined ? {} : metadata,
        createdAt: now,
      })
    },
  }
}
