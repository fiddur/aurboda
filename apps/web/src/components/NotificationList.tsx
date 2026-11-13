import type { Notification } from '@aurboda/api-spec'

import { useLocation } from 'preact-iso'
import { useState } from 'preact/hooks'

import { formatRelative } from '../pages/AdminUsers/admin-users-utils'
import { useMarkNotificationRead, useRunNotificationAction } from './notification-queries'
import { isInAppLink } from './notifications'
import './NotificationBell.css'

interface NotificationListProps {
  notifications: Notification[]
  /** Called after a notification is activated, e.g. to close the dropdown. */
  onActivated?: () => void
}

export function NotificationList({ notifications, onActivated }: NotificationListProps) {
  const { route } = useLocation()
  const markRead = useMarkNotificationRead()
  const runAction = useRunNotificationAction()
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})

  if (notifications.length === 0) return <p class="notification-empty">No notifications yet.</p>

  const activate = (notification: Notification) => {
    if (notification.read_at === null) markRead.mutate(notification.id)
    if (isInAppLink(notification.link)) route(notification.link)
    onActivated?.()
  }

  const run = (notification: Notification, key: string) => {
    setActionErrors(({ [notification.id]: _, ...rest }) => rest)
    runAction.mutate(
      { id: notification.id, key },
      {
        onError: (error) =>
          setActionErrors((errors) => ({
            ...errors,
            [notification.id]: error instanceof Error ? error.message : 'Couldn’t do that. Please try again.',
          })),
      },
    )
  }

  const running = runAction.isPending ? runAction.variables : undefined

  const now = new Date()
  return (
    <ul class="notification-list">
      {notifications.map((notification) => {
        const unread = notification.read_at === null
        return (
          <li key={notification.id}>
            <button
              type="button"
              class={`notification-item${unread ? ' unread' : ''}`}
              onClick={() => activate(notification)}
            >
              <span class="notification-dot" aria-hidden="true" />
              <span class="notification-text">
                <span class="notification-title">
                  {unread && <span class="notification-sr">Unread: </span>}
                  {notification.title}
                </span>
                {notification.body && <span class="notification-body">{notification.body}</span>}
                <time class="notification-time" dateTime={notification.created_at}>
                  {formatRelative(notification.created_at, now)}
                </time>
              </span>
            </button>
            {notification.actions.length > 0 && (
              <div class="notification-actions">
                {notification.actions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    class="notification-action"
                    disabled={running?.id === notification.id}
                    onClick={() => run(notification, action.key)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
            {actionErrors[notification.id] && (
              <p class="notification-action-error" role="alert">
                {actionErrors[notification.id]}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
