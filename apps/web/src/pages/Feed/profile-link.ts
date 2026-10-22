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

export interface ActorProfileLink {
  /** Where the actor's name should link. */
  href: string
  /** True for a remote actor — the link leaves this instance, so it should open
   *  externally (a new tab in the browser, the system browser from the app). */
  external: boolean
}

/**
 * A link to an actor's profile: the local `/u/:username` page when the actor
 * lives on `host`, otherwise the actor's own (remote) URL flagged `external`.
 * Only http(s) actor URIs are linkable; anything else returns null so callers
 * render plain text.
 */
export const actorProfileLink = (actorUri: string, host: string): ActorProfileLink | null => {
  const local = localProfilePath(actorUri, host)
  if (local) return { external: false, href: local }
  try {
    const url = new URL(actorUri)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return { external: true, href: actorUri }
  } catch {
    return null
  }
}
