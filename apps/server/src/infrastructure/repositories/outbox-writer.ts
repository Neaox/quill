import type { OutboxWriter } from '@quill/application'

import { outboxEvents } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

/**
 * Written in the same transaction as the change it reports (plan §22) —
 * callers use this inside `UnitOfWork.run`, never on its own.
 */
export function createOutboxWriter(db: DrizzleClient): OutboxWriter {
  return {
    async write({ id, type, payload, now }): Promise<void> {
      await db.insert(outboxEvents).values({
        id,
        type,
        payload,
        createdAt: now,
        availableAt: now,
      })
    },
  }
}
