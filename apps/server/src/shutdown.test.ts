import { describe, expect, it, vi } from 'vitest'

import { createShutdown } from './shutdown.ts'

/**
 * The order is the behaviour: the job runner has to stop before the pool it
 * polls, and the HTTP server has to drain before the pool its handlers query.
 * Anything else loses work that a consumer or a request had already started.
 */

type Close = () => Promise<void>

function closing(record: string[], name: string): Close {
  return async () => {
    record.push(name)
  }
}

function parts(record: string[]) {
  return {
    jobRunner: { stop: vi.fn<Close>(closing(record, 'jobRunner')) },
    app: { close: vi.fn<Close>(closing(record, 'app')) },
    database: { close: vi.fn<Close>(closing(record, 'database')) },
  }
}

/** A promise plus the function that settles it, for pausing a step mid-shutdown. */
function pause(): { readonly waited: Promise<void>; readonly release: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>()
  return { waited: promise, release: () => resolve() }
}

describe('createShutdown', () => {
  it('stops the job runner, then the app, then the database', async () => {
    const record: string[] = []
    await createShutdown(parts(record))()
    expect(record).toEqual(['jobRunner', 'app', 'database'])
  })

  it('waits for work in flight before moving on', async () => {
    const record: string[] = []
    const pieces = parts(record)
    const poll = pause()
    pieces.jobRunner.stop = vi.fn<Close>(async () => {
      await poll.waited
      record.push('jobRunner')
    })

    const shutting = createShutdown(pieces)()
    // The app is still open while the poll is running: nothing after the
    // runner has been touched yet.
    await Promise.resolve()
    expect(record).toEqual([])
    expect(pieces.app.close).not.toHaveBeenCalled()

    poll.release()
    await shutting
    expect(record).toEqual(['jobRunner', 'app', 'database'])
  })

  it('closes once however many signals arrive', async () => {
    const record: string[] = []
    const pieces = parts(record)
    const shutdown = createShutdown(pieces)

    // SIGTERM, then an impatient SIGINT before the first has finished.
    await Promise.all([shutdown(), shutdown()])
    await shutdown()

    expect(record).toEqual(['jobRunner', 'app', 'database'])
    expect(pieces.database.close).toHaveBeenCalledTimes(1)
  })
})
