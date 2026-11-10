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

/** Absolute URL of a user's blog view: their public articles. */
export const buildBlogUrl = (webHost: string, username: string): string =>
  joinUrl(webHost, `u/${encodeURIComponent(username)}/articles`)

/** Absolute URL of the Atom feed of a user's public articles (an API endpoint). */
export const buildArticlesAtomUrl = (apiBaseUrl: string, username: string): string =>
  joinUrl(apiBaseUrl, `public/${encodeURIComponent(username)}/articles.atom`)

/** Absolute URL of the instance's official feed, its blog. */
export const buildOfficialFeedUrl = (webHost: string): string => joinUrl(webHost, 'blog')

/** Absolute URL of the official feed's Atom document (an API endpoint). */
export const buildOfficialFeedAtomUrl = (apiBaseUrl: string): string =>
  joinUrl(apiBaseUrl, 'public/official-feed.atom')

/** Absolute URL of a public tag page. */
export const buildPublicTagUrl = (webHost: string, tag: string): string =>
  joinUrl(webHost, `tags/${encodeURIComponent(tag)}`)

/** Absolute URL of a public tag page's Atom document (an API endpoint). */
export const buildPublicTagAtomUrl = (apiBaseUrl: string, tag: string): string =>
  joinUrl(apiBaseUrl, `public/tags/${encodeURIComponent(tag)}.atom`)

/** Absolute URL of a single feed post's permalink page. */
export const buildPostUrl = (webHost: string, username: string, postId: string): string =>
  joinUrl(webHost, `u/${encodeURIComponent(username)}/posts/${encodeURIComponent(postId)}`)

/** Absolute URL of a single shared dashboard. */
export const buildShareUrl = (webHost: string, username: string, slug: string): string =>
  joinUrl(webHost, `u/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`)

/** Absolute URL of a challenge's banner image, versioned so a replacement busts caches. */
export const bannerVersion = (updatedAt: Date): string => String(updatedAt.getTime())

export const buildBannerUrl = (webHost: string, username: string, slug: string, version: Date): string =>
  `${buildShareUrl(webHost, username, slug)}/banner.webp?v=${bannerVersion(version)}`

/** A user's ActivityPub actor id. */
export const buildActorUrl = (webHost: string, username: string): string =>
  joinUrl(webHost, `users/${encodeURIComponent(username)}`)
