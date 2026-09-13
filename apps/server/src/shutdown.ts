/**
 * Stopping the process without losing work in flight (plan §22).
 *
 * The order is the whole of it, and it is not arbitrary:
 *
 * 1. **The job runner first.** It is the only thing that starts work nobody
 *    asked for, and `stop()` waits for the poll that is already running.
 *    Closing the pool under an in-flight poll would fail a consumer that had
 *    already done its side effect.
 * 2. **Then the HTTP server.** `close()` stops accepting connections and lets
 *    the requests already in a handler finish.
 * 3. **Then the database.** By now nothing holds a connection, so the pool
 *    drains rather than tearing live queries out from under callers.
 *
 * Reversing any pair loses work, which is why this is a named function with a
 * test that pins the order rather than four lines in a signal handler.
 *
 * It is also idempotent: `SIGTERM` followed by an impatient `SIGINT` must not
 * start a second shutdown across the first, and a second caller waits for the
 * first rather than returning early into a process that is still closing.
 */

export interface ShutdownParts {
  /** Stops scheduling and waits for the poll in flight. */
  readonly jobRunner: { stop(): Promise<void> }
  /** Stops accepting connections and drains the handlers already running. */
  readonly app: { close(): Promise<void> }
  readonly database: { close(): Promise<void> }
}

export interface Shutdown {
  (): Promise<void>
}

export function createShutdown(parts: ShutdownParts): Shutdown {
  let running: Promise<void> | null = null

  async function closeEverything(): Promise<void> {
    await parts.jobRunner.stop()
    await parts.app.close()
    await parts.database.close()
  }

  return async function shutdown(): Promise<void> {
    // The same promise, so a second signal waits for the first shutdown to
    // finish rather than returning into a half-closed process.
    running ??= closeEverything()
    await running
  }
}
