/**
 * What Mastodon keeps of a status's HTML: a port of `Sanitize::Config::MASTODON_STRICT`
 * (mastodon/mastodon `lib/sanitize_ext/sanitize_config.rb`) on `sanitize-html`, for the
 * article preview's Mastodon view. Not an XSS boundary of its own: the web sanitises again.
 */
import sanitizeHtml from 'sanitize-html'

const ELEMENTS = [
  'p',
  'br',
  'span',
  'a',
  'del',
  's',
  'pre',
  'blockquote',
  'code',
  'b',
  'strong',
  'u',
  'i',
  'em',
  'ul',
  'ol',
  'li',
  'ruby',
  'rt',
  'rp',
]

const LINK_PROTOCOLS = [
  'http',
  'https',
  'dat',
  'dweb',
  'ipfs',
  'ipns',
  'ssb',
  'gopher',
  'xmpp',
  'magnet',
  'gemini',
]

const KEPT_CLASS = /^(?:(?:h|p|u|dt|e)-.*|mention|hashtag|ellipsis|invisible|quote-inline)$/

const SCHEME = /^\s*([^/#]*?)(?::|&#0*58|&#x0*3a)/i

const linkScheme = (href: string | undefined): string | null => {
  if (href === undefined) return null
  const match = SCHEME.exec(href)
  return match ? match[1].toLowerCase() : null
}

const isSupportedLink = (href: string | undefined): boolean => {
  const scheme = linkScheme(href)
  return scheme != null && LINK_PROTOCOLS.includes(scheme)
}

const keptAttributes = (attribs: sanitizeHtml.Attributes): sanitizeHtml.Attributes => {
  const kept = { ...attribs }
  if (kept.class !== undefined) {
    const classes = kept.class.split(/[\t\n\f\r ]+/).filter((name) => KEPT_CLASS.test(name))
    if (classes.length > 0) kept.class = classes.join(' ')
    else delete kept.class
  }
  if (kept.translate !== undefined && kept.translate !== 'no') delete kept.translate
  return kept
}

const OPTIONS: sanitizeHtml.IOptions = {
  allowedAttributes: {
    '*': ['lang'],
    a: ['href', 'rel', 'class', 'translate', 'target'],
    li: ['value'],
    ol: ['start', 'reversed'],
    p: ['class'],
    span: ['class', 'translate'],
  },
  allowedSchemes: LINK_PROTOCOLS,
  allowProtocolRelative: false,
  allowedTags: ELEMENTS,
  disallowedTagsMode: 'discard',
  // Unwrapping here rather than renaming the tag to a disallowed one in `transformTags`:
  // sanitize-html then leaves the rename in place for the next closing tag at that depth.
  exclusiveFilter: (frame) =>
    frame.tag === 'a' && !isSupportedLink(frame.attribs.href) ? 'excludeTag' : false,
  transformTags: {
    '*': (tagName, attribs) => {
      if (tagName !== 'a' || !isSupportedLink(attribs.href)) {
        return { attribs: keptAttributes(attribs), tagName }
      }
      return {
        attribs: { ...keptAttributes(attribs), rel: 'nofollow noopener', target: '_blank' },
        tagName,
      }
    },
  },
}

const HEADING_OPEN = /<h[1-6](?:\s[^>]*)?>/gi
const HEADING_CLOSE = /<\/h[1-6]\s*>/gi

/**
 * `html` as Mastodon stores it: only its strict elements and attributes, `h1`–`h6` as bold
 * paragraphs, links forced to `rel="nofollow noopener" target="_blank"`, a link whose scheme
 * Mastodon does not allow (or a relative one) replaced by its text, classes kept only when
 * Mastodon knows them and `translate` only when it is `no`.
 */
export const mastodonSanitize = (html: string): string =>
  sanitizeHtml(
    html.replaceAll(HEADING_OPEN, '<p><strong>').replaceAll(HEADING_CLOSE, '</strong></p>'),
    OPTIONS,
  )

const HASHTAG_LINK =
  /<a\s[^>]*class="[^"]*\bhashtag\b[^"]*"[^>]*>#<span>([^<]+)<\/span><\/a>|<a\s[^>]*class="[^"]*\bhashtag\b[^"]*"[^>]*>#([^<]+)<\/a>/gi

const LAST_PARAGRAPH = /<p(?:\s[^>]*)?>((?:(?!<p[\s>]).)*?)<\/p>\s*$/is

const decodeText = (text: string): string =>
  text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&')

const tagOf = (match: RegExpMatchArray): string =>
  decodeText(match[1] ?? match[2] ?? '')
    .normalize('NFC')
    .toLowerCase()

/** The tags of the hashtag links in `html`, lowercase and without `#`, in order and once each. */
export const linkedHashtags = (html: string): string[] => [
  ...new Set([...html.matchAll(HASHTAG_LINK)].map(tagOf)),
]

/**
 * Mastodon's hashtag bar: when the last paragraph holds only hashtag links (and whitespace), it is
 * taken out of the text and its tags are shown as a bar under the media.
 */
export const splitTrailingHashtags = (html: string): { content: string; tags: string[] } => {
  const last = LAST_PARAGRAPH.exec(html)
  if (last == null) return { content: html, tags: [] }
  const tags = linkedHashtags(last[1])
  if (tags.length === 0 || last[1].replaceAll(HASHTAG_LINK, '').trim() !== '') {
    return { content: html, tags: [] }
  }
  return { content: html.slice(0, last.index).trimEnd(), tags }
}
