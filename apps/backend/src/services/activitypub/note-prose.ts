/**
 * Authored markdown rendered for federation, in two shapes:
 *
 * - `renderProse` — full HTML (GFM tables, images, `hr`, h5/h6), for consumers
 *   that render it (the Atom feed).
 * - `renderNoteProse` — HTML shaped for a Mastodon status. Mastodon's inbound
 *   sanitiser keeps only `p br span a del s pre blockquote code b strong u i em
 *   ul ol li` (h1–h6 become bold paragraphs) and drops `table` and `img`, so a
 *   table would run together as one line and an inline image would vanish. Here a
 *   table becomes one paragraph of `<br>`-separated lines and an image a link (or
 *   whatever inline reference the caller supplies).
 *
 * Both go through an outbound allowlist: an XSS boundary like the inbound
 * fediverse sanitiser, so neither can carry a script/style/`img onerror` payload
 * (#910's boundary, server side).
 */
import { Marked, marked, type Tokens } from 'marked'
import sanitizeHtml from 'sanitize-html'

import { escapeXml } from '../charts/chart-svg.ts'

const ARTICLE_TAGS = [
  'p',
  'br',
  'a',
  'span',
  'em',
  'strong',
  'b',
  'i',
  'del',
  's',
  'u',
  'pre',
  'code',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
]

const NOTE_DROPPED_TAGS = new Set(['img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr'])

const sanitizeOptions = (allowedTags: string[]): sanitizeHtml.IOptions => ({
  allowedAttributes: {
    a: ['href', 'rel', 'target', 'class', 'translate'],
    img: ['src', 'alt', 'title'],
    ol: ['start'],
    span: ['class', 'translate'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedTags,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer', target: '_blank' }),
  },
})

const ARTICLE_SANITIZE_OPTIONS = sanitizeOptions(ARTICLE_TAGS)
const NOTE_SANITIZE_OPTIONS = sanitizeOptions(ARTICLE_TAGS.filter((tag) => !NOTE_DROPPED_TAGS.has(tag)))

/**
 * Sanitise authored article prose for outbound federation. A superset of the
 * inbound fediverse allowlist (`sanitizeRemoteHtml`) — the same safe base, plus
 * the block elements a QS write-up uses (GFM tables, images, `hr`, h5/h6), which
 * the web DOMPurify sink keeps. The two configs are maintained separately, not
 * literally shared — inbound is intentionally stricter. Still a hard XSS
 * boundary: no script/style/iframe/event handlers survive, and link/image URLs
 * are http(s)/mailto only.
 */
export const sanitizeArticleHtml = (html: string): string => sanitizeHtml(html, ARTICLE_SANITIZE_OPTIONS)

/** `sanitizeArticleHtml` minus what Mastodon drops anyway (tables, images, `hr`). */
const sanitizeNoteHtml = (html: string): string => sanitizeHtml(html, NOTE_SANITIZE_OPTIONS)

/**
 * Render one run of authored markdown to sanitised, federation-safe HTML. Options
 * (GFM + hard line breaks) are passed per call, matching the web's `renderMarkdown`
 * (#910) without mutating `marked`'s process-wide defaults for every other importer.
 */
export const renderProse = (markdown: string): string =>
  sanitizeArticleHtml(marked.parse(markdown, { async: false, breaks: true, gfm: true }))

export const httpUrl = (src: string): URL | null => {
  if (!URL.canParse(src)) return null
  const url = new URL(src)
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
}

/**
 * The http(s) pictures authored markdown embeds through image syntax, in document
 * order, a repeated URL kept once. The same images the Note attaches as figures
 * and the author's renderer draws, so a structured payload can declare them.
 */
export const declaredProseImages = (markdown: string): { alt: string; url: string }[] => {
  const images: { alt: string; url: string }[] = []
  const seen = new Set<string>()
  marked.walkTokens(marked.lexer(markdown, { breaks: true, gfm: true }), (token) => {
    if (token.type !== 'image') return
    const { href, text } = token as Tokens.Image
    if (httpUrl(href) == null || seen.has(href)) return
    seen.add(href)
    images.push({ alt: text, url: href })
  })
  return images
}

export interface NoteProseImage {
  src: string
  alt: string
}

export interface NoteProseOptions {
  /** Inline HTML standing in for a prose image; default is a link to it. */
  image?: (image: NoteProseImage) => string
}

const defaultImage = ({ alt, src }: NoteProseImage): string =>
  `<a href="${escapeXml(src)}">${escapeXml(alt || src)}</a>`

const isBlank = (html: string): boolean => html.trim() === ''

const tableLines = (header: string[], rows: string[][]): string[] => {
  if (rows.length === 0) return [header.filter((cell) => !isBlank(cell)).join(' · ')]
  const corner = header[0] ?? ''
  const bodyLines = rows.map(([first = '', ...rest]) => {
    const values = rest
      .map((cell, i) => {
        if (isBlank(cell)) return ''
        const column = header[i + 1] ?? ''
        return isBlank(column) ? cell : `${column} ${cell}`
      })
      .filter((value) => value !== '')
      .join(' · ')
    if (isBlank(first)) return values
    return values === '' ? `<strong>${first}</strong>` : `<strong>${first}</strong>: ${values}`
  })
  return [isBlank(corner) ? '' : `<em>${corner}</em>`, ...bodyLines].filter((line) => line !== '')
}

/**
 * Render authored markdown for a Mastodon-read Note: the `renderProse` pipeline,
 * except a GFM table is one `<p>` with a line per body row (`**row**: Column value
 * · …`, the corner header in italics first) and an image is `opts.image`'s inline
 * HTML, else a link to it. The result never contains a table, image or `hr`, even
 * typed as raw HTML.
 */
export const renderNoteProse = (markdown: string, opts: NoteProseOptions = {}): string => {
  const image = opts.image ?? defaultImage
  const renderer = new Marked({
    async: false,
    breaks: true,
    gfm: true,
    renderer: {
      image(token: Tokens.Image): string {
        return image({ alt: token.text, src: token.href })
      },
      table(token: Tokens.Table): string {
        const inline = (cell: Tokens.TableCell): string => this.parser.parseInline(cell.tokens).trim()
        const lines = tableLines(
          token.header.map(inline),
          token.rows.map((row) => row.map(inline)),
        )
        return `<p>${lines.join('<br>')}</p>\n`
      },
    },
  })
  return sanitizeNoteHtml(renderer.parse(markdown, { async: false }))
}
