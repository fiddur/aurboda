/**
 * A post's hashtags in its federated Note: Mastodon links and indexes a tag
 * only when the Note carries it as an AS2 `Hashtag` AND shows it as a link in
 * `content`. Every Note builder and the owner/preview `content` go through
 * here, so what the web shows is what federates. Each tag links to the
 * author's public profile filtered by it (`/u/<user>?tag=<tag>`).
 */
import { findHashtags } from '@aurboda/api-spec'
import { Hashtag } from '@fedify/fedify/vocab'

import { buildProfileUrl } from '../share-urls.ts'

export interface HashtagLinks {
  tags: readonly string[]
  /** The author's public profile URL; each tag's link is it plus `?tag=`. */
  profileUrl: string
}

export const hashtagLinks = (
  webHost: string,
  user: string,
  tags: readonly string[] | undefined,
): HashtagLinks => ({
  profileUrl: buildProfileUrl(webHost, user),
  tags: tags ?? [],
})

export const hashtagHref = (profileUrl: string, tag: string): string =>
  `${profileUrl}?tag=${encodeURIComponent(tag)}`

const escapeAttr = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const hashtagAnchor = (profileUrl: string, tag: string, written: string): string =>
  `<a href="${escapeAttr(hashtagHref(profileUrl, tag))}" class="mention hashtag" rel="tag">#<span>${written}</span></a>`

/** Elements whose text is never linkified: an existing link, and code. */
const SKIPPED_ELEMENTS = new Set(['a', 'code', 'pre'])
const TAG_NAME = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)/

/**
 * Link the post's tags in server-built (already escaped/sanitised) `html`:
 * each typed `#tag` in a text node — not inside `<a>`, `<code>` or `<pre>` —
 * becomes a hashtag link keeping its written casing, and the tags the text
 * does not show are appended as one trailing paragraph of links. Tags typed but
 * not among the post's tags (past the cap) stay plain text. The tag splitting
 * assumes no attribute value holds a raw `>`, which sanitiser output guarantees.
 */
export const linkifyHashtags = (html: string, links: HashtagLinks | undefined): string => {
  if (links == null || links.tags.length === 0) return html
  const wanted = new Set(links.tags)
  const shown = new Set<string>()
  let skipDepth = 0
  const linked = html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        const element = TAG_NAME.exec(part)
        if (element && SKIPPED_ELEMENTS.has(element[2].toLowerCase()) && !part.endsWith('/>')) {
          skipDepth = Math.max(0, skipDepth + (element[1] ? -1 : 1))
        }
        return part
      }
      if (skipDepth > 0 || !part.includes('#')) return part
      const text = part.normalize('NFC')
      let out = ''
      let cursor = 0
      for (const match of findHashtags(text)) {
        if (!wanted.has(match.tag)) continue
        shown.add(match.tag)
        out += text.slice(cursor, match.index) + hashtagAnchor(links.profileUrl, match.tag, match.text)
        cursor = match.index + 1 + match.text.length
      }
      return out + text.slice(cursor)
    })
    .join('')
  const missing = links.tags.filter((tag) => !shown.has(tag))
  if (missing.length === 0) return linked
  return `${linked}<p>${missing.map((tag) => hashtagAnchor(links.profileUrl, tag, tag)).join(' ')}</p>`
}

/** The Note's `Hashtag` tags, one per post tag. */
export const hashtagObjects = (links: HashtagLinks): Hashtag[] =>
  links.tags.map((tag) => new Hashtag({ href: new URL(hashtagHref(links.profileUrl, tag)), name: `#${tag}` }))
