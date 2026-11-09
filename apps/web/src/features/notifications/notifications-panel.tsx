import { Link } from '@tanstack/react-router'

import { Button, RelativeTime, tv } from '@quill/ui'

import {
  useMarkNotificationsRead,
  useWorkspaceList,
  type NotificationItem,
} from '../../lib/api/index.ts'
import { documentReference, workspaceReference } from '../../lib/routing/document-reference.ts'

export const notificationsPanelStyles = tv({
  slots: {
    head: 'flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5',
    title: 'text-sm font-semibold text-foreground',
    list: 'flex min-h-0 grow flex-col overflow-y-auto overscroll-contain p-1.5',
    item: [
      'group flex items-start gap-3 rounded-md px-2.5 py-2 text-sm',
      'transition-colors ease-standard hover:bg-surface',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    marker: [
      'mt-1.5 size-2 shrink-0 rounded-full border border-border',
      'in-data-unread:border-transparent in-data-unread:bg-accent',
    ],
    text: 'min-w-0 grow text-foreground-soft in-data-unread:text-foreground',
    when: 'mt-0.5 block text-xs text-muted',
    empty: 'px-4 py-8 text-center text-sm text-muted',
  },
})

type ReviewItem = Exclude<NotificationItem, { kind: 'source-sync-failed' }>
type SourceItem = Extract<NotificationItem, { kind: 'source-sync-failed' }>

const VERB: Record<ReviewItem['kind'], string> = {
  'review-requested': 'asked you to review',
  'changes-requested': 'asked for changes to',
  'review-approved': 'approved',
  'review-withdrawn': 'withdrew the review of',
}

/** Why a source stopped syncing, as the end of a sentence; the settings page has the detail. */
const SOURCE_FAILURE: Readonly<Record<string, string>> = {
  'branch-not-found': 'its branch was not found',
  'credential-unavailable': 'its credential could not be read',
  'blocked-by-outbound-policy': 'the instance may not reach its host',
  'invalid-manifest': 'its manifest does not read',
  timeout: 'the repository took too long to answer',
  'history-rewritten': 'its history was rewritten',
}

function sourceFailure(reason: string): string {
  return SOURCE_FAILURE[reason] ?? 'the repository could not be read'
}

export interface NotificationsPanelProps {
  readonly items: readonly NotificationItem[]
  readonly unread: number
}

/** The inside of the bell's panel: each notification as a sentence that is also the way in to its document. */
export function NotificationsPanel({ items, unread }: NotificationsPanelProps) {
  const workspaces = useWorkspaceList()
  const markRead = useMarkNotificationsRead()
  const styles = notificationsPanelStyles()

  const slugOf = (workspaceId: string) => {
    const workspace = workspaces.data?.find((entry) => entry.id === workspaceId)
    return workspace === undefined ? undefined : workspaceReference(workspace)
  }

  return (
    <>
      <div className={styles.head()}>
        <p className={styles.title()}>Notifications</p>
        {unread === 0 ? undefined : (
          <Button
            variant="ghost"
            size="sm"
            loading={markRead.isPending}
            onClick={() => {
              markRead.mutate(undefined)
            }}
          >
            Mark all as read
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className={styles.empty()}>You’re all caught up.</p>
      ) : (
        <ul className={styles.list()}>
          {items.map((item) => {
            const isUnread = item.readAt === null
            const onOpen = () => {
              if (isUnread) markRead.mutate([item.id])
            }
            return (
              <li key={item.id} data-unread={isUnread ? '' : undefined}>
                {item.kind === 'source-sync-failed' ? (
                  <SourceNotification item={item} onOpen={onOpen} />
                ) : (
                  <ReviewNotification
                    item={item}
                    workspaceSlug={slugOf(item.document.workspaceId)}
                    onOpen={onOpen}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

interface NotificationLinkProps<T> {
  readonly item: T
  readonly onOpen: () => void
}

/** Someone did something about a review: the sentence is the way in to the document. */
function ReviewNotification({
  item,
  workspaceSlug,
  onOpen,
}: NotificationLinkProps<ReviewItem> & { readonly workspaceSlug: string | undefined }) {
  const styles = notificationsPanelStyles()
  if (workspaceSlug === undefined) return undefined
  return (
    <Link
      to="/w/$workspaceSlug/d/$documentId"
      params={{ workspaceSlug, documentId: documentReference(item.document) }}
      search={{}}
      className={styles.item()}
      onClick={onOpen}
    >
      <span aria-hidden="true" className={styles.marker()} />
      <span className={styles.text()}>
        {item.readAt === null ? <span className="sr-only">Unread. </span> : undefined}
        {item.actor.name} {VERB[item.kind]}{' '}
        <strong className="font-semibold text-foreground">{item.document.title}</strong>
        <span className={styles.when()}>
          <RelativeTime value={item.at} />
        </span>
      </span>
    </Link>
  )
}

/**
 * A workspace's repository stopped syncing (ADR-061), told once to its
 * administrators: the way in is the workspace's settings, where the source is.
 */
function SourceNotification({ item, onOpen }: NotificationLinkProps<SourceItem>) {
  const styles = notificationsPanelStyles()
  return (
    <Link
      to="/w/$workspaceSlug/settings"
      params={{ workspaceSlug: workspaceReference(item.workspace) }}
      className={styles.item()}
      onClick={onOpen}
    >
      <span aria-hidden="true" className={styles.marker()} />
      <span className={styles.text()}>
        {item.readAt === null ? <span className="sr-only">Unread. </span> : undefined}
        <strong className="font-semibold text-foreground">{item.workspace.name}</strong> stopped
        syncing from its repository: {sourceFailure(item.failure.reason)}.
        <span className={styles.when()}>
          <RelativeTime value={item.at} />
        </span>
      </span>
    </Link>
  )
}
