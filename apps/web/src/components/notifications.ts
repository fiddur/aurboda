import type { Notification, NotificationsResponse } from '@aurboda/api-spec'

/** The badge's text: nothing at zero, the count up to nine, then `9+`. */
export const badgeText = (unread: number): string => (unread <= 0 ? '' : unread > 9 ? '9+' : String(unread))

export const bellLabel = (unread: number): string =>
  unread <= 0 ? 'Notifications' : `Notifications, ${unread} unread`

/** A path inside this app (`/x`), never a protocol-relative `//host` one. */
export const isInAppLink = (link: string | null): link is string =>
  link !== null && link.startsWith('/') && !link.startsWith('//')

const markOne = (notification: Notification, id: string, readAt: string): Notification =>
  notification.id === id && notification.read_at === null
    ? { ...notification, read_at: readAt }
    : notification

/** One page after marking `id` read, with the unread count lowered when it was an unread in-app one. */
export const markReadInPage = (
  page: NotificationsResponse,
  id: string,
  readAt: string,
): NotificationsResponse => {
  const target = page.notifications.find((n) => n.id === id)
  const wasUnread = target !== undefined && target.read_at === null && target.in_app
  return {
    ...page,
    notifications: page.notifications.map((n) => markOne(n, id, readAt)),
    unread_count: wasUnread ? Math.max(0, page.unread_count - 1) : page.unread_count,
  }
}

export const markAllReadInPage = (page: NotificationsResponse, readAt: string): NotificationsResponse => ({
  ...page,
  notifications: page.notifications.map((n) => (n.read_at === null ? { ...n, read_at: readAt } : n)),
  unread_count: 0,
})
