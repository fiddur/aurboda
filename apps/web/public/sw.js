/*
 * Aurboda's service worker: browser push only, no caching and no fetch handler.
 * It is served as-is, outside the bundle, so the few pure helpers below mirror
 * `parsePushPayload` and `pushTargetUrl` in src/components/push.ts (tested there).
 */

const NOTIFICATION_READ_PARAM = 'notification_read'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const parsePayload = (event) => {
  try {
    const raw = event.data ? event.data.json() : null
    if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string') return null
    return {
      body: typeof raw.body === 'string' ? raw.body : null,
      id: raw.id,
      link: typeof raw.link === 'string' ? raw.link : null,
      title: raw.title,
    }
  } catch {
    return null
  }
}

const targetUrl = (link, id) => {
  const origin = self.location.origin
  const path =
    typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : '/notifications'
  let url = new URL(path, origin)
  if (url.origin !== origin) url = new URL('/notifications', origin)
  else if (UUID_RE.test(id)) url.searchParams.set(NOTIFICATION_READ_PARAM, id)
  return url.toString()
}

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  const payload = parsePayload(event)
  if (!payload) return
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body ?? undefined,
      data: { id: payload.id, link: payload.link },
      icon: '/android-chrome-192x192.png',
      tag: payload.id,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const url = targetUrl(data.link, data.id)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
      if (open) {
        try {
          const focused = await open.focus()
          if (await focused.navigate(url)) return
        } catch {
          // navigate() refuses a tab this worker does not control; a new window still opens.
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
