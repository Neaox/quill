/**
 * Windows filesystem contention, which research R4 found twice in the publish
 * path and which is invisible on Linux and macOS:
 *
 * - `rename()` over a destination another handle has open fails with EPERM,
 *   EACCES, or EBUSY instead of replacing it. git-for-windows solves it the
 *   same way: a bounded retry with a short backoff.
 * - `open(O_EXCL)` on a lock file whose previous holder has just unlinked it
 *   fails with EPERM while the entry is in "pending delete" state. That is not
 *   a fault: it means contended, so the caller should lose the race and retry.
 *
 * The two cases need different answers, so they have different predicates.
 * {@link isRenameContention} is deliberately generous, because every code it
 * covers really does clear on its own when a rename loses a race with another
 * handle. {@link isLockContention} is deliberately strict: a lock file that
 * cannot be created when nothing is there to collide with is a permission or
 * disk fault, and reporting it as "somebody else is publishing" would send the
 * caller into a retry loop over an error that never clears.
 */

import { existsSync } from 'node:fs'
import { rename, stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

/** Codes a rename can fail with while another handle holds the destination. */
const RENAME_CONTENTION_CODES: ReadonlySet<string> = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY'])

/** The pending-delete window, which only Windows has. */
const PENDING_DELETE_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY'])

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
}

export function isRenameContention(error: unknown): boolean {
  const code = errorCode(error)
  return code !== undefined && RENAME_CONTENTION_CODES.has(code)
}

/**
 * Whether a failed exclusive create of `lockPath` means another holder.
 *
 * EEXIST always does. Windows also reports a lock file in "pending delete"
 * state as EPERM or EBUSY, but only while the entry is still there: the same
 * codes with nothing at the path are a permission or sharing fault, and EACCES
 * and ENOSPC are always themselves and are reported as themselves.
 */
export function isLockContention(error: unknown, lockPath: string): boolean {
  const code = errorCode(error)
  if (code === 'EEXIST') return true
  if (code === undefined || !PENDING_DELETE_CODES.has(code)) return false
  return existsSync(lockPath)
}

/**
 * How long ago `path` was last written, in milliseconds, or null when it is no
 * longer there. A lock file that vanishes while it is being examined was never
 * leaked: the holder finished.
 */
export async function fileAge(path: string, now: Date): Promise<number | null> {
  try {
    return now.getTime() - (await stat(path)).mtimeMs
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
    return null
  }
}

export interface RetryOptions {
  readonly attempts?: number
  readonly sleep?: (ms: number) => Promise<void>
}

/**
 * Retry an operation that lost a race with another handle on the same file.
 * On Linux and macOS `rename(2)` is atomic and this never spins.
 */
export async function retryOnContention<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 50
  const sleep = options.sleep ?? delay
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= attempts || !isRenameContention(error)) throw error
      await sleep(Math.min(attempt, 10))
    }
  }
}

export function renameWithRetry(from: string, to: string, options?: RetryOptions): Promise<void> {
  return retryOnContention(() => rename(from, to), options)
}
