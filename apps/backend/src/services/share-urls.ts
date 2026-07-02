/**
 * Absolute URL builders for the public sharing surface.
 *
 * The federation key is a user's full public base URL, which may include a
 * scheme and a sub-path (e.g. `http://some.thing/with/other/things`). We join
 * carefully so a configured sub-path is preserved and slashes don't double up.
 */
const joinUrl = (base: string, path: string): string =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`

/** Absolute URL of a user's public profile page. */
export const buildProfileUrl = (webHost: string, username: string): string =>
  joinUrl(webHost, `u/${encodeURIComponent(username)}`)

/** Absolute URL of a single shared dashboard. */
export const buildShareUrl = (webHost: string, username: string, slug: string): string =>
  joinUrl(webHost, `u/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`)
