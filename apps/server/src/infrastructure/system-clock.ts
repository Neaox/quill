import type { Clock } from '@quill/application'

/** The real clock, used only at the composition root (`main.ts`); everything else takes a `Clock`. */
export function createSystemClock(): Clock {
  return { now: () => new Date() }
}
