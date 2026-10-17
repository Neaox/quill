import { onDemand, ProgressBar, useOnDemand } from '@quill/ui'

import type { AttachmentsPanelProps } from './attachments-dialog.tsx'

export type { AttachmentsPanelProps } from './attachments-dialog.tsx'

/**
 * The attachments dialog is its own chunk (quill-plan.md section 31): it is a
 * menu item away, and most readers never open it. It is fetched in idle time
 * once a document is open, and at once if it is opened first (`onDemand` in
 * `@quill/ui`); once here it stays mounted, so it opens and closes exactly as
 * it always has.
 */
const attachmentsDialog = onDemand(() => import('./attachments-dialog.tsx'))

/** What a document carries, and the way to take one down. See `AttachmentsDialog`. */
export function AttachmentsPanel(props: AttachmentsPanelProps) {
  const loaded = useOnDemand(attachmentsDialog, props.open)
  if (loaded !== undefined) return <loaded.AttachmentsDialog {...props} />
  // Only while the chunk is still on its way: normally never.
  return props.open ? <ProgressBar placement="top" label="Opening attachments" /> : undefined
}
