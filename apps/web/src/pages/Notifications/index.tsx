import type { NotificationsResponse } from '@aurboda/api-spec'

import { type InfiniteData, useInfiniteQuery } from '@tanstack/react-query'

import { NOTIFICATION_PAGES_KEY, useMarkAllNotificationsRead } from '../../components/notification-queries'
import { NotificationList } from '../../components/NotificationList'
import { fetchNotifications } from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

const PAGE_SIZE = 30

export function Notifications() {
  const isLoggedIn = Boolean(auth.value.token)
  const markAll = useMarkAllNotificationsRead()
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<
    NotificationsResponse,
    Error,
    InfiniteData<NotificationsResponse>,
    readonly string[],
    string | undefined
  >({
    enabled: isLoggedIn,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) => fetchNotifications({ cursor: pageParam, limit: PAGE_SIZE }),
    queryKey: NOTIFICATION_PAGES_KEY,
  })

  if (!isLoggedIn) {
    return (
      <div class="notifications-page">
        <h1>Notifications</h1>
        <p>Please log in to see your notifications.</p>
      </div>
    )
  }

  const notifications = data?.pages.flatMap((page) => page.notifications) ?? []
  const unread = data?.pages[0]?.unread_count ?? 0

  return (
    <div class="notifications-page">
      <div class="notifications-header">
        <h1>Notifications</h1>
        <button
          type="button"
          class="notification-mark-all"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Mark all read
        </button>
      </div>
      {isLoading ? (
        <p class="notification-empty">Loading…</p>
      ) : error ? (
        <p class="notification-empty">Couldn't load notifications. Please try again.</p>
      ) : (
        <div class="notifications-card">
          <NotificationList notifications={notifications} />
        </div>
      )}
      {hasNextPage && (
        <button
          type="button"
          class="notifications-more"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
      <p class="notifications-settings-link">
        Choose which notifications show here and which are pushed to your phone in{' '}
        <a href="/settings#notifications">Settings</a>.
      </p>
    </div>
  )
}
