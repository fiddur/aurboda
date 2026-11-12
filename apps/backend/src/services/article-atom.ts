/**
 * Atom 1.0 syndication of public posts for readers without a fediverse account:
 * a user's public articles, and the instance's official feed. Article bodies
 * reuse the markdown export (prose verbatim, each renderable chart/correlation
 * block as an image link to its public PNG) rendered through the outbound
 * article sanitiser, so a feed reader shows the same prose and chart images a
 * federated Note carries; other posts carry the HTML they federate with.
 */
import type { ArticleContent, FeedPost, FeedVisibility } from '@aurboda/api-spec'

import { renderProse } from './activitypub/article-object.ts'
import { renderChallengeShareHtml } from './activitypub/challenge-object.ts'
import { buildArticleMarkdown } from './article-export.ts'
import { escapeXml } from './charts/chart-svg.ts'
import {
  buildArticlesAtomUrl,
  buildBlogUrl,
  buildOfficialFeedAtomUrl,
  buildOfficialFeedUrl,
  buildPostUrl,
  buildProfileUrl,
  buildPublicTagAtomUrl,
  buildPublicTagUrl,
} from './share-urls.ts'

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

/** An official-feed entry: any post kind, by one of the feed's users. */
export interface AtomPostEntry extends AtomArticleEntry {
  username: string
}

export type AtomPostSource = Pick<
  FeedPost,
  'activity_title' | 'article' | 'challenge' | 'content' | 'dashboard' | 'exercise' | 'kind' | 'message'
>

const ENTRY_TITLE_MAX = 80

const ENTITIES: Record<string, string> = { '#39': "'", amp: '&', gt: '>', lt: '<', quot: '"' }

const textOf = (html: string): string =>
  html
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ENTITIES[entity])

const truncate = (text: string): string => {
  const flat = text.replaceAll(/\s+/g, ' ').trim()
  if (flat.length <= ENTRY_TITLE_MAX) return flat
  const cut = flat.slice(0, ENTRY_TITLE_MAX - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > ENTRY_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * A feed entry's title: what the post is called (an article's title, the
 * shared activity's title, the exercise, dashboard or challenge name), else the start of
 * its text.
 */
export const postEntryTitle = (post: AtomPostSource): string => {
  const named =
    post.article?.title ??
    post.activity_title ??
    post.exercise?.name ??
    post.dashboard?.name ??
    post.challenge?.name
  if (named) return named
  const text = truncate(post.message ?? textOf(post.content ?? ''))
  return text || 'Post'
}

/**
 * A non-article post's entry body: the HTML it federates with — the activity
 * or exercise summary `content`, or a challenge's invitation — else its
 * message rendered as prose.
 */
export const postEntryHtml = (post: AtomPostSource): string => {
  if (post.kind === 'challenge' && post.challenge) {
    return renderChallengeShareHtml(post.challenge, post.message ?? null)
  }
  if (post.content) return post.content
  return post.message ? renderProse(post.message) : ''
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

interface AtomAuthor {
  name: string
  uri: string
}

interface AtomEntryXml extends AtomArticleEntry {
  /** The entry's Atom `<id>`: a permalink for our own posts, the note's id for a tag page's. */
  entry_id: string
  url: string
  author?: AtomAuthor
}

interface AtomDocument {
  /** The HTML page the feed mirrors: its id and `alternate` link. */
  pageUrl: string
  selfUrl: string
  title: string
  /** The feed's author; absent when every entry names its own. */
  author?: AtomAuthor
  entries: AtomEntryXml[]
  now: Date
}

const link = (rel: string, type: string, href: string): string =>
  `<link rel="${rel}" type="${type}" href="${escapeXml(href)}"/>`

const authorXml = ({ name, uri }: AtomAuthor): string =>
  `<author><name>${escapeXml(name)}</name><uri>${escapeXml(uri)}</uri></author>`

const buildAtom = ({ author, entries, now, pageUrl, selfUrl, title }: AtomDocument): string => {
  const updated = entries.reduce((latest, e) => (e.updated_at > latest ? e.updated_at : latest), new Date(0))
  const entryXml = entries.map((entry) =>
    [
      '  <entry>',
      `    <id>${escapeXml(entry.entry_id)}</id>`,
      `    <title type="text">${escapeXml(entry.title)}</title>`,
      `    ${link('alternate', 'text/html', entry.url)}`,
      ...(entry.author ? [`    ${authorXml(entry.author)}`] : []),
      `    <published>${entry.created_at.toISOString()}</published>`,
      `    <updated>${entry.updated_at.toISOString()}</updated>`,
      `    <content type="html">${escapeXml(entry.html)}</content>`,
      '  </entry>',
    ].join('\n'),
  )
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(pageUrl)}</id>`,
    `  <title type="text">${escapeXml(title)}</title>`,
    `  ${link('alternate', 'text/html', pageUrl)}`,
    `  ${link('self', 'application/atom+xml', selfUrl)}`,
    `  <updated>${(entries.length > 0 ? updated : now).toISOString()}</updated>`,
    ...(author ? [`  ${authorXml(author)}`] : []),
    '  <generator uri="https://github.com/fiddur/aurboda">Aurboda</generator>',
    ...entryXml,
    '</feed>',
    '',
  ].join('\n')
}

interface AtomFeedInput {
  webHost: string
  apiBaseUrl: string
  username: string
  entries: AtomArticleEntry[]
  /** The feed's `updated` when it has no entries. */
  now: Date
}

export const blogTitle = (username: string): string => `${username}'s blog — Aurboda`

export const buildArticlesAtom = ({ apiBaseUrl, entries, now, username, webHost }: AtomFeedInput): string =>
  buildAtom({
    author: { name: username, uri: buildProfileUrl(webHost, username) },
    entries: entries.map((entry) => {
      const url = buildPostUrl(webHost, username, entry.id)
      return { ...entry, entry_id: url, url }
    }),
    now,
    pageUrl: buildBlogUrl(webHost, username),
    selfUrl: buildArticlesAtomUrl(apiBaseUrl, username),
    title: blogTitle(username),
  })

/** The official feed's name: the instance's host, e.g. `aurboda.net blog`. */
export const officialFeedTitle = (webHost: string): string => {
  try {
    return `${new URL(webHost).host} blog`
  } catch {
    return 'Blog'
  }
}

/** A post on a public tag page: from any server, its HTML already sanitised. */
export interface AtomTagEntry {
  note_uri: string
  url: string | null
  actor_uri: string
  handle: string | null
  display_name: string | null
  content: string
  images: { url: string; name?: string }[]
  published_at: Date
  updated_at: Date
}

interface TagFeedAtomInput {
  webHost: string
  apiBaseUrl: string
  tag: string
  entries: AtomTagEntry[]
  now: Date
}

export const publicTagFeedTitle = (webHost: string, tag: string): string => {
  try {
    return `#${tag} on ${new URL(webHost).host}`
  } catch {
    return `#${tag}`
  }
}

/** A remote post's title: the first line of its text, else its author. */
export const remoteEntryTitle = (entry: Pick<AtomTagEntry, 'content'>, authorName: string): string => {
  const firstLine = entry.content
    .split(/<\/p>|<br\s*\/?>|\n/i)
    .map((line) => textOf(line).trim())
    .find((line) => line !== '')
  return firstLine ? truncate(firstLine) : authorName
}

const tagAuthorName = (entry: AtomTagEntry): string => entry.display_name ?? entry.handle ?? entry.actor_uri

const tagEntryHtml = (entry: AtomTagEntry): string =>
  [
    entry.content,
    ...entry.images.map(
      (image) => `<p><img src="${escapeXml(image.url)}" alt="${escapeXml(image.name ?? '')}"/></p>`,
    ),
  ].join('')

export const buildTagFeedAtom = ({ apiBaseUrl, entries, now, tag, webHost }: TagFeedAtomInput): string =>
  buildAtom({
    entries: entries.map((entry) => {
      const name = tagAuthorName(entry)
      return {
        author: { name, uri: entry.actor_uri },
        created_at: entry.published_at,
        entry_id: entry.note_uri,
        html: tagEntryHtml(entry),
        id: entry.note_uri,
        title: name,
        updated_at: entry.updated_at,
        url: entry.url ?? entry.note_uri,
      }
    }),
    now,
    pageUrl: buildPublicTagUrl(webHost, tag),
    selfUrl: buildPublicTagAtomUrl(apiBaseUrl, tag),
    title: publicTagFeedTitle(webHost, tag),
  })

/** An official-feed entry: a local user's post, or one by an author on another server. */
export type OfficialFeedAtomEntry =
  | ({ origin: 'local' } & AtomPostEntry)
  | ({ origin: 'remote' } & AtomTagEntry)

interface OfficialFeedAtomInput {
  webHost: string
  apiBaseUrl: string
  entries: OfficialFeedAtomEntry[]
  now: Date
}

const officialFeedEntryXml = (webHost: string, entry: OfficialFeedAtomEntry): AtomEntryXml => {
  if (entry.origin === 'remote') {
    const name = tagAuthorName(entry)
    return {
      author: { name, uri: entry.actor_uri },
      created_at: entry.published_at,
      entry_id: entry.note_uri,
      html: tagEntryHtml(entry),
      id: entry.note_uri,
      title: remoteEntryTitle(entry, name),
      updated_at: entry.updated_at,
      url: entry.url ?? entry.note_uri,
    }
  }
  const url = buildPostUrl(webHost, entry.username, entry.id)
  return {
    ...entry,
    author: { name: entry.username, uri: buildProfileUrl(webHost, entry.username) },
    entry_id: url,
    url,
  }
}

export const buildOfficialFeedAtom = ({ apiBaseUrl, entries, now, webHost }: OfficialFeedAtomInput): string =>
  buildAtom({
    entries: entries.map((entry) => officialFeedEntryXml(webHost, entry)),
    now,
    pageUrl: buildOfficialFeedUrl(webHost),
    selfUrl: buildOfficialFeedAtomUrl(apiBaseUrl),
    title: officialFeedTitle(webHost),
  })
