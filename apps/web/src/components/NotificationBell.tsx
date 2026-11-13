import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import { useLatestNotifications, useMarkAllNotificationsRead } from './notification-queries'
import { NotificationList } from './NotificationList'
import { badgeText, bellLabel } from './notifications'
import './NotificationBell.css'

function Badge({ unread }: { unread: number }) {
  const text = badgeText(unread)
  return text ? (
    <span class="notification-badge" aria-hidden="true">
      {text}
    </span>
  ) : null
}

/** The narrow top bar's bell: a link to the notifications page. */
export function NotificationBellLink() {
  const { url } = useLocation()
  const unread = useLatestNotifications().data?.unread_count ?? 0
  return (
    <a
      href="/notifications"
      class={`notification-bell nav-mobile-bell${url === '/notifications' ? ' active' : ''}`}
      aria-label={bellLabel(unread)}
    >
      <span aria-hidden="true">🛎️</span>
      <Badge unread={unread} />
    </a>
  )
}

/** The sidebar's bell: toggles a dropdown with the latest notifications. */
export function NotificationBellDropdown() {
  const { url } = useLocation()
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const { data, isLoading, error } = useLatestNotifications()
  const markAll = useMarkAllNotificationsRead()
  const unread = data?.unread_count ?? 0

  useEffect(() => setOpen(false), [url])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div class="notification-bell-wrapper" ref={wrapper}>
      <button
        type="button"
        class="notification-bell sidebar-bell"
        aria-label={bellLabel(unread)}
        aria-expanded={open}
        aria-controls="notification-panel"
        title={bellLabel(unread)}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">🛎️</span>
        <Badge unread={unread} />
      </button>
      {open && (
        <div class="notification-panel" id="notification-panel" role="dialog" aria-label="Notifications">
          <div class="notification-panel-header">
            <h2>Notifications</h2>
            <button
              type="button"
              class="notification-mark-all"
              disabled={unread === 0 || markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </button>
          </div>
          <div class="notification-panel-body">
            {isLoading ? (
              <p class="notification-empty">Loading…</p>
            ) : error ? (
              <p class="notification-empty">Couldn't load notifications.</p>
            ) : (
              <NotificationList notifications={data?.notifications ?? []} onActivated={close} />
            )}
          </div>
          <div class="notification-panel-footer">
            <a href="/notifications" onClick={close}>
              See all
            </a>
            <a href="/settings#notifications" onClick={close}>
              Settings
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
