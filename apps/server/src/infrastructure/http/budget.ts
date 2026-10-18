import { OutboundRequestError } from './outbound-error.ts'

/**
 * One deadline for a whole outbound call (ADR-011, ADR-042).
 *
 * A call is several steps (resolving the name, connecting, waiting for headers,
 * every redirect, and then reading the body), and a timer that covers only some
 * of them leaves the rest for a server to stretch out: a host that answers its
 * headers at once and then drips its body would hold a socket until the size cap
 * was reached, a byte at a time. So there is one clock, started when the call
 * starts and stopped when it ends, and every step is raced against it.
 *
 * `guard` is the race: it stops a step that ignores its `AbortSignal` (a DNS
 * lookup, a test double) on time. The signal is for the steps that do honour
 * it, and tears the socket down.
 */

export interface Budget {
  readonly signal: AbortSignal
  guard<T>(work: Promise<T>): Promise<T>
  /** Aborts the transfer now, for a reason other than the clock (a body over its cap). */
  stop(): void
  dispose(): void
}

export function startBudget(milliseconds: number): Budget {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Reject before aborting: aborting makes an in-flight request fail with
      // an `AbortError`, and the caller must see the reason, not that echo.
      reject(new OutboundRequestError('timeout', `No complete response within ${milliseconds} ms`))
      controller.abort()
    }, milliseconds)
  })
  // The deadline is only ever raced; it must not report as unhandled when the
  // call finishes first.
  deadline.catch(() => undefined)
  return {
    signal: controller.signal,
    guard: (work) => Promise.race([work, deadline]),
    stop: () => controller.abort(),
    dispose: () => clearTimeout(timer),
  }
}
