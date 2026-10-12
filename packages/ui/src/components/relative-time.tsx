import { useCallback, useSyncExternalStore } from 'react'

import { elapsedClock } from '../lib/time/elapsed-clock.ts'
import {
  FULL_MOMENT,
  formatMoment,
  toMilliseconds,
  type MomentStyle,
  type MomentValue,
} from '../lib/time/moment.ts'

export interface RelativeTimeProps {
  readonly value: MomentValue
  /**
   * Keeps the words true as time passes ("just now", then "1 minute ago", then "2 minutes
   * ago"). On by default, and cheap: every live time on the page shares one timer
   * (`elapsed-clock.ts`). Off, the words are as they were when it was drawn.
   */
  readonly live?: boolean
  /** A language, when it should not be the reader's own. */
  readonly locale?: string | undefined
  /** What hovering shows. The whole moment, in the reader's language, by default. */
  readonly title?: MomentStyle | Intl.DateTimeFormatOptions
  readonly className?: string | undefined
}

const noop = (): void => undefined

/**
 * "2 minutes ago", as a `<time>`: the moment is in `dateTime` for anything that reads it, and
 * hovering shows it in full, in the reader's own language (`Intl`), so the short saying never
 * costs anyone the exact time. Under a minute is "just now".
 *
 * It stays true without costing the page: a `useSyncExternalStore` over the shared clock, whose
 * snapshot is the words themselves, so this re-renders only when they change, and one timer
 * serves a thousand of them.
 */
export function RelativeTime({ value, live = true, locale, title, className }: RelativeTimeProps) {
  const at = toMilliseconds(value)
  const subscribe = useCallback(
    (onChange: () => void) => (live ? elapsedClock.subscribe(at, locale, onChange) : noop),
    [at, live, locale],
  )
  const read = useCallback(() => elapsedClock.read(at, locale), [at, locale])
  const words = useSyncExternalStore(subscribe, read, read)

  if (Number.isNaN(at)) return undefined
  const moment = new Date(at)
  return (
    <time
      dateTime={moment.toISOString()}
      title={formatMoment(moment, title ?? FULL_MOMENT, locale)}
      className={className}
    >
      {words}
    </time>
  )
}
