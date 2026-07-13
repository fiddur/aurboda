/**
 * The local profile path (`/u/:username`) for an ActivityPub actor URI, or null
 * when the actor is remote — a Mastodon or other-instance user has no page on
 * this instance, so their handle links out to their own server instead.
 *
 * An actor is local when its URI host matches the host being browsed; local
 * actor URIs are `<host>/users/<username>`. `host` is normally
 * `window.location.host` (the SPA and the actor share one origin).
 */
export const localProfilePath = (actorUri: string, host: string): string | null => {
  try {
    const url = new URL(actorUri)
    if (url.host !== host) return null
    const match = url.pathname.match(/^\/users\/([^/]+)\/?$/)
    return match ? `/u/${encodeURIComponent(decodeURIComponent(match[1]))}` : null
  } catch {
    return null
  }
}
