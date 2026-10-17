import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Block, buttonClassName, Callout, LayoutGrid, RelativeTime } from '@quill/ui'

import { PreviewLink } from './preview-link.tsx'

/**
 * "You have unpublished changes", above a page that does not show them.
 *
 * What a document says is what was last published, and what an editor has
 * written since is a draft the page cannot show. Nothing on the page said so, so
 * an author who closed the editor without publishing came back to the old text
 * and no sign that the new was anywhere. This says it, to the people who can do
 * something about it, and goes straight to the two things they would: carry on
 * writing, or look at the draft as readers will.
 *
 * Told by the envelope, which is the one authority on whether the draft says
 * something the published page does not; this only says so when it is asked to,
 * and to a person who may edit.
 */

export interface DraftNoticeProps {
  readonly workspaceSlug: string
  /** The document as the route has it: its id or its readable reference. */
  readonly documentId: string
  /** When the draft was last saved, as an ISO timestamp. */
  readonly savedAt: string
  /** More to do with the draft, beside the two here: a phone's way to ask for a review. */
  readonly actions?: ReactNode
}

export function DraftNotice({ workspaceSlug, documentId, savedAt, actions }: DraftNoticeProps) {
  return (
    <LayoutGrid className="pt-6">
      <Block>
        <Callout tone="info" title="You have unpublished changes">
          <p>
            Saved <RelativeTime value={savedAt} />. Readers still see the published page.
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              to="/w/$workspaceSlug/d/$documentId/edit"
              params={{ workspaceSlug, documentId }}
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            >
              Resume editing
            </Link>
            <PreviewLink documentRef={documentId} draft variant="ghost" size="sm" />
            {actions}
          </p>
        </Callout>
      </Block>
    </LayoutGrid>
  )
}
