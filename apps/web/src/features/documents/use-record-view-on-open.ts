import { useEffect, useRef } from 'react'

import { useRecordView } from '../../lib/api/index.ts'

/**
 * Tells the server this document was opened, once per time the page is shown for it, so the
 * person's own "Jump back in" and the order of their workspaces know where they have been
 * (ADR-053).
 *
 * A report to an external system, which is what an effect is for; and a failure is ignored, because
 * not keeping a record must never get in the way of reading. The server ignores a repeat
 * within minutes, so a quick return costs nothing either.
 */
export function useRecordViewOnOpen(documentId: string): void {
  const { mutate } = useRecordView()
  const reported = useRef<string | undefined>(undefined)

  /* Synchronises with the server's record of what this person has opened, an external system:
     it is told once per document shown, and its answer is not used. */
  useEffect(() => {
    if (reported.current === documentId) return
    reported.current = documentId
    mutate(documentId)
  }, [documentId, mutate])
}
