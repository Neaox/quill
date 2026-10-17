import { Suspense, useState, type ReactNode } from 'react'

export interface MountOnFirstOpenProps {
  readonly open: boolean
  /**
   * Elements of `lazy` components, for what a reader may never open and so should not weigh on
   * the reading route's first load (quill-plan.md section 31): nothing is fetched until they render.
   */
  readonly children: ReactNode
}

/**
 * Renders `children` from the first time `open` is true, and keeps them
 * mounted afterwards, so a dialog's own close animation and state are
 * unaffected and only the first opening waits for the module.
 *
 * "Opened once" is derived while rendering rather than set from an effect
 * (AGENTS.md rule 6): it is a function of `open` and what has been seen.
 */
export function MountOnFirstOpen({ open, children }: MountOnFirstOpenProps) {
  const [everOpened, setEverOpened] = useState(open)
  if (open && !everOpened) setEverOpened(true)
  return everOpened ? <Suspense fallback={null}>{children}</Suspense> : undefined
}
