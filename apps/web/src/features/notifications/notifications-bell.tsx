import { Link } from '@tanstack/react-router'

import { BellIcon, Button, Popover, RelativeTime, tv } from '@quill/ui'

import {
  useMarkNotificationsRead,
  useNotifications,
  useWorkspaceList,
  type NotificationItem,
} from '../../lib/api/index.ts'
import { documentReference, workspaceReference } from '../../lib/routing/document-reference.ts'

export const notificationsStyles = tv({
  slots: {
    dot: [
      'absolute end-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full',
      'bg-accent px-1 text-2xs leading-4 font-semibold text-accent-foreground tabular-nums',
    ],
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

const VERB: Record<NotificationItem['kind'], string> = {
  'review-requested': 'asked you to review',
  'changes-requested': 'asked for changes to',
  'review-approved': 'approved',
  'review-withdrawn': 'withdrew the review of',
}

/**
 * What has happened that concerns the person, from the bar of every signed-in page.
 *
 * A bell with the unread count, and a short panel: each notification is a sentence that says who
 * did what to which document, and is the way in to it. Following one marks it read; "Mark all as
 * read" clears the rest. The count is in the button's name, because a number painted on an icon is
 * nothing to a screen reader.
 */
export function NotificationsBell() {
  const notifications = useNotifications()
  const workspaces = useWorkspaceList()
  const markRead = useMarkNotificationsRead()
  const styles = notificationsStyles()

  const items = notifications.data?.items ?? []
  const unread = notifications.data?.unread ?? 0
  const slugOf = (workspaceId: string) => {
    const workspace = workspaces.data?.find((entry) => entry.id === workspaceId)
    return workspace === undefined ? undefined : workspaceReference(workspace)
  }

  return (
    <Popover
      label={unread === 0 ? 'Notifications' : `Notifications, ${String(unread)} unread`}
      title="Notifications"
      trigger={
        <>
          <BellIcon />
          {unread === 0 ? undefined : (
            <span aria-hidden="true" className={styles.dot()}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </>
      }
    >
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
            const workspaceSlug = slugOf(item.document.workspaceId)
            const isUnread = item.readAt === null
            return (
              <li key={item.id} data-unread={isUnread ? '' : undefined}>
                {workspaceSlug === undefined ? undefined : (
                  <Link
                    to="/w/$workspaceSlug/d/$documentId"
                    params={{
                      workspaceSlug,
                      documentId: documentReference(item.document),
                    }}
                    search={{}}
                    className={styles.item()}
                    onClick={() => {
                      if (isUnread) markRead.mutate([item.id])
                    }}
                  >
                    <span aria-hidden="true" className={styles.marker()} />
                    <span className={styles.text()}>
                      {isUnread ? <span className="sr-only">Unread. </span> : undefined}
                      {item.actor.name} {VERB[item.kind]}{' '}
                      <strong className="font-semibold text-foreground">
                        {item.document.title}
                      </strong>
                      <span className={styles.when()}>
                        <RelativeTime value={item.at} />
                      </span>
                    </span>
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Popover>
  )
}
