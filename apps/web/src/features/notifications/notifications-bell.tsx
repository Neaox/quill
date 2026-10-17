import { lazy, Suspense } from 'react'

import { BellIcon, Popover, tv } from '@quill/ui'

import { useNotifications } from '../../lib/api/index.ts'

/**
 * What the panel lists is read only by somebody who opens it, so it is a chunk of its own
 * rather than part of every signed-in page (quill-plan.md section 31).
 */
const NotificationsPanel = lazy(async () => ({
  default: (await import('./notifications-panel.tsx')).NotificationsPanel,
}))

export const notificationsStyles = tv({
  slots: {
    dot: [
      'absolute end-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full',
      'bg-accent px-1 text-2xs leading-4 font-semibold text-accent-foreground tabular-nums',
    ],
  },
})

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
  const styles = notificationsStyles()

  const items = notifications.data?.items ?? []
  const unread = notifications.data?.unread ?? 0

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
      <Suspense fallback={null}>
        <NotificationsPanel items={items} unread={unread} />
      </Suspense>
    </Popover>
  )
}
