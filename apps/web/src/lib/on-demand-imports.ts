/**
 * Every module the application imports on demand, followed until it arrives
 * or fails.
 *
 * A chunk fetched when it is wanted (the tokenizer for a code sample, a
 * dialog, an editor, the diagram renderer) is a promise nobody may be
 * waiting on: an effect starts it and moves on. In the app that is the point.
 * Under test it is a load that can outlive the test that started it, still
 * importing modules after the test environment is gone, which fails a later
 * run of the suite at random (`EnvironmentTeardownError`) rather than the
 * test that caused it. So every dynamic import in the app goes through
 * `importOnDemand`, and the test setup waits for all of them to settle after
 * each test (`settleImportsOnDemand`). `on-demand-imports.test.ts` holds the
 * app's source to that.
 */

const pending = new Set<Promise<unknown>>()

/** Starts a dynamic import and follows it until it settles. Returns the import's own promise. */
export function importOnDemand<T>(load: () => Promise<T>): Promise<T> {
  const request = load()
  pending.add(request)
  const settled = (): void => {
    pending.delete(request)
  }
  void request.then(settled, settled)
  return request
}

/**
 * Resolves once every import started so far has settled, and every import
 * those started too. Never rejects: a failed import is its caller's to report.
 */
export async function settleImportsOnDemand(): Promise<void> {
  while (pending.size > 0) {
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- an import that settles may start another, which this round must wait for too
    await Promise.allSettled(pending)
  }
}
