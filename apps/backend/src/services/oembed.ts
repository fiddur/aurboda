/**
 * oEmbed (https://oembed.com) response building for public share resources.
 *
 * We emit `type: "link"` — the widely-supported form that gives consumers
 * (Mastodon, etc.) a title, author, provider, and a thumbnail (the resource's
 * OG image) without an embeddable iframe.
 */
import { OG_HEIGHT, OG_WIDTH } from './og-image.ts'
import { SITE_NAME } from './share-meta.ts'

export interface OEmbedLink {
  version: '1.0'
  type: 'link'
  title: string
  author_name: string
  author_url: string
  provider_name: string
  provider_url: string
  thumbnail_url: string
  thumbnail_width: number
  thumbnail_height: number
}

export const buildOEmbedLink = (input: {
  title: string
  authorName: string
  authorUrl: string
  providerUrl: string
  thumbnailUrl: string
}): OEmbedLink => ({
  author_name: input.authorName,
  author_url: input.authorUrl,
  provider_name: SITE_NAME,
  provider_url: input.providerUrl,
  thumbnail_height: OG_HEIGHT,
  thumbnail_url: input.thumbnailUrl,
  thumbnail_width: OG_WIDTH,
  title: input.title,
  type: 'link',
  version: '1.0',
})

export interface ParsedShareUrl {
  username: string
  /** Present for a dashboard/challenge; absent for a profile. */
  slug?: string
}

/**
 * Extract the `{username, slug?}` of a share resource from a `/u/...` URL,
 * tolerating a sub-path-hosted base. Returns null if the path isn't a share
 * URL. Only the last two `/u/<a>/<b>` (or one `/u/<a>`) segments are used.
 */
export const parseShareUrl = (url: string): ParsedShareUrl | null => {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return null
  }
  const marker = pathname.lastIndexOf('/u/')
  if (marker === -1) return null
  const rest = pathname
    .slice(marker + 3)
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s))
  if (rest.length === 1) return { username: rest[0] }
  if (rest.length === 2) return { slug: rest[1], username: rest[0] }
  return null
}
