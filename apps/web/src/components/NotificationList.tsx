import type { Notification } from '@aurboda/api-spec'

import { useLocation } from 'preact-iso'

import { formatRelative } from '../pages/AdminUsers/admin-users-utils'
import { useMarkNotificationRead } from './notification-queries'
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

  if (notifications.length === 0) return <p class="notification-empty">No notifications yet.</p>

  const activate = (notification: Notification) => {
    if (notification.read_at === null) markRead.mutate(notification.id)
    if (isInAppLink(notification.link)) route(notification.link)
    onActivated?.()
  }

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
          </li>
        )
      })}
    </ul>
  )
}
