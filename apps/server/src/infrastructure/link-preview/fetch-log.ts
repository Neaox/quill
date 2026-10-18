import type { FetchEvent, FetchObserver } from '../http/open-web-client.ts'

/**
 * Where fetch events go (ADR-042): the application's logger, one line per fetch.
 *
 * The logger belongs to the HTTP server, which is built after the fetcher the
 * server's dependencies include, so it is looked up when an event arrives and
 * not when the observer is made. Until there is one, events are dropped, which
 * is the right thing to do with a log nobody has opened yet.
 */

export interface FetchLogSink {
  info(event: Record<string, unknown>, message: string): void
}

export function createFetchObserver(sink: () => FetchLogSink | undefined): FetchObserver {
  return (event: FetchEvent) => {
    sink()?.info(
      {
        host: event.host,
        purpose: event.purpose,
        outcome: event.outcome,
        status: event.status,
        redirects: event.redirects,
        bytes: event.bytes,
        durationMs: event.durationMs,
      },
      'link preview fetch',
    )
  }
}
