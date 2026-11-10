/** Path of the instance's official feed, its blog. */
export const officialFeedPath = '/blog'

/** Path of a user's blog view: their public articles. */
export const blogPath = (username: string): string => `/u/${encodeURIComponent(username)}/articles`

/**
 * Absolute URL of the Atom feed of a user's public articles, resolved against
 * the page origin so a relative `API_URL` (`/api` in production) still yields a
 * URL a feed reader can subscribe to.
 */
export const buildArticlesAtomUrl = (username: string, apiUrl: string, pageOrigin: string): string => {
  const path = `${apiUrl.replace(/\/+$/, '')}/public/${encodeURIComponent(username)}/articles.atom`
  try {
    return new URL(path, pageOrigin).toString()
  } catch {
    return path
  }
}

/** Absolute URL of the official feed's Atom document, resolved like {@link buildArticlesAtomUrl}. */
export const buildOfficialFeedAtomUrl = (apiUrl: string, pageOrigin: string): string => {
  const path = `${apiUrl.replace(/\/+$/, '')}/public/official-feed.atom`
  try {
    return new URL(path, pageOrigin).toString()
  } catch {
    return path
  }
}

/** Path of a public tag page. */
export const publicTagPath = (tag: string): string => `/tags/${encodeURIComponent(tag)}`

/** Absolute URL of a public tag page's Atom document, resolved like {@link buildArticlesAtomUrl}. */
export const buildPublicTagAtomUrl = (tag: string, apiUrl: string, pageOrigin: string): string => {
  const path = `${apiUrl.replace(/\/+$/, '')}/public/tags/${encodeURIComponent(tag)}.atom`
  try {
    return new URL(path, pageOrigin).toString()
  } catch {
    return path
  }
}
