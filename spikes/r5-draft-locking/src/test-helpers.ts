import { createPool, setupSchema, truncateAll } from './db.ts'

export const pool = createPool()

export async function ensureSchema(): Promise<void> {
  await setupSchema(pool)
}

export async function resetTables(): Promise<void> {
  await truncateAll(pool)
}

/** Deterministic instants derived from a fixed epoch, so tests never touch the wall clock. */
export function at(msFromEpoch: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0) + msFromEpoch)
}
