/**
 * Atom 1.0 syndication of a user's public articles — the instance blog for
 * readers without a fediverse account. Entry bodies reuse the markdown export
 * (prose verbatim, each renderable chart/correlation block as an image link to
 * its public PNG) rendered through the outbound article sanitiser, so a feed
 * reader shows the same prose and chart images a federated Note carries.
 */
import type { ArticleContent, FeedVisibility } from '@aurboda/api-spec'

import { renderProse } from './activitypub/article-object.ts'
import { buildArticleMarkdown } from './article-export.ts'
import { escapeXml } from './charts/chart-svg.ts'
import { buildArticlesAtomUrl, buildBlogUrl, buildPostUrl, buildProfileUrl } from './share-urls.ts'

export const ATOM_CONTENT_TYPE = 'application/atom+xml; charset=utf-8'

/** How many of the newest articles the feed carries. */
export const ATOM_ENTRY_LIMIT = 20

export interface AtomArticleSource {
  id: string
  visibility: FeedVisibility
  image_token: string
  created_at: Date
  updated_at: Date
  article: ArticleContent
}

export interface AtomArticleEntry {
  id: string
  title: string
  html: string
  created_at: Date
  updated_at: Date
}

/**
 * An article's body as HTML for a feed entry: the markdown export without its
 * leading `# title` line (Atom carries the title itself), rendered and sanitised
 * like federated prose. `renderableBlocks` marks the chart blocks whose image
 * would render; the others become a "not enough data" line.
 */
export const articleEntryHtml = (
  apiBaseUrl: string,
  username: string,
  source: AtomArticleSource,
  renderableBlocks?: ReadonlySet<number>,
): string => {
  const markdown = buildArticleMarkdown(
    apiBaseUrl,
    username,
    source.id,
    source.visibility,
    source.image_token,
    source.updated_at,
    source.article,
    renderableBlocks,
  )
  const titleEnd = markdown.indexOf('\n\n')
  return titleEnd === -1 ? '' : renderProse(markdown.slice(titleEnd + 2))
}

interface AtomFeedInput {
  webHost: string
  apiBaseUrl: string
  username: string
  entries: AtomArticleEntry[]
  /** The feed's `updated` when it has no entries. */
  now: Date
}

const link = (rel: string, type: string, href: string): string =>
  `<link rel="${rel}" type="${type}" href="${escapeXml(href)}"/>`

export const blogTitle = (username: string): string => `${username}'s blog — Aurboda`

export const buildArticlesAtom = ({ apiBaseUrl, entries, now, username, webHost }: AtomFeedInput): string => {
  const blogUrl = buildBlogUrl(webHost, username)
  const updated = entries.reduce((latest, e) => (e.updated_at > latest ? e.updated_at : latest), new Date(0))
  const entryXml = entries.map((entry) => {
    const url = buildPostUrl(webHost, username, entry.id)
    return [
      '  <entry>',
      `    <id>${escapeXml(url)}</id>`,
      `    <title type="text">${escapeXml(entry.title)}</title>`,
      `    ${link('alternate', 'text/html', url)}`,
      `    <published>${entry.created_at.toISOString()}</published>`,
      `    <updated>${entry.updated_at.toISOString()}</updated>`,
      `    <content type="html">${escapeXml(entry.html)}</content>`,
      '  </entry>',
    ].join('\n')
  })
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(blogUrl)}</id>`,
    `  <title type="text">${escapeXml(blogTitle(username))}</title>`,
    `  ${link('alternate', 'text/html', blogUrl)}`,
    `  ${link('self', 'application/atom+xml', buildArticlesAtomUrl(apiBaseUrl, username))}`,
    `  <updated>${(entries.length > 0 ? updated : now).toISOString()}</updated>`,
    `  <author><name>${escapeXml(username)}</name><uri>${escapeXml(buildProfileUrl(webHost, username))}</uri></author>`,
    '  <generator uri="https://github.com/fiddur/aurboda">Aurboda</generator>',
    ...entryXml,
    '</feed>',
    '',
  ].join('\n')
}
