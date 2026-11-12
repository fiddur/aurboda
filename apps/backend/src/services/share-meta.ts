/**
 * JS-less crawlers (Facebook, Slack, LinkedIn, Discord, iMessage) never execute
 * the SPA, so they only see whatever `<head>` the server sends. These pure
 * helpers build Open Graph / Twitter Card / description meta (plus schema.org
 * JSON-LD) for a public resource and inject it into the SPA's index.html
 * template. The body stays a client-rendered SPA; only the head is enriched.
 *
 * Everything here is a pure function of already-resolved, non-sensitive data —
 * callers must resolve visibility first and never pass a private resource in.
 */

import type { ChallengeTimeStatus, OfficialFeedSetting } from '@aurboda/api-spec'

export const SITE_NAME = 'Aurboda'

/** Path (relative to the web host) of the branded fallback preview image. */
export const DEFAULT_OG_IMAGE_PATH = '/og-default.png'

export interface ShareMeta {
  /** Full document title, e.g. `My dashboard — Aurboda`. */
  title: string
  /** Plain-text description for `<meta name="description">` and og/twitter. */
  description: string
  /** Canonical absolute URL of the resource. */
  url: string
  /** Absolute URL of the preview image (1200×630). */
  image: string
  imageAlt: string
  /** Open Graph object type. */
  type: 'website' | 'profile' | 'article'
  /** Optional schema.org JSON-LD object embedded as a <script> tag. */
  jsonLd?: Record<string, unknown>
  /** Optional oEmbed discovery URL (adds a `<link rel="alternate">`). */
  oembedUrl?: string
  /** Optional Atom feed URL (adds a feed-discovery `<link rel="alternate">`). */
  feedUrl?: string
}

/** oEmbed discovery URL for a resource (consumers fetch this for a rich unfurl). */
export const oembedDiscoveryUrl = (webHost: string, resourceUrl: string): string =>
  `${webHost.replace(/\/+$/, '')}/oembed?url=${encodeURIComponent(resourceUrl)}&format=json`

/** Absolute URL of the branded fallback preview image. */
export const defaultOgImage = (webHost: string): string =>
  `${webHost.replace(/\/+$/, '')}${DEFAULT_OG_IMAGE_PATH}`

/** Absolute URL of a resource's dynamically rendered preview image. */
export const resourceOgImage = (resourceUrl: string): string =>
  `${resourceUrl.replace(/\/+$/, '')}/opengraph-image.png`

/** Escape a string for use in HTML element text content. */
const escapeHtmlText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Escape a string for use inside a double-quoted HTML attribute value. */
const escapeAttr = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/**
 * JSON for a JSON-LD <script> block. `</` is escaped so a string value can't
 * prematurely close the script element (XSS-safe embedding).
 */
const jsonLdScript = (data: Record<string, unknown>): string =>
  `<script type="application/ld+json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`

/** Render the block of share meta tags (no surrounding whitespace assumptions). */
export const renderShareMetaTags = (meta: ShareMeta): string => {
  const tags = [
    `<meta name="description" content="${escapeAttr(meta.description)}">`,
    `<link rel="canonical" href="${escapeAttr(meta.url)}">`,
    `<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">`,
    `<meta property="og:type" content="${meta.type}">`,
    `<meta property="og:title" content="${escapeAttr(meta.title)}">`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}">`,
    `<meta property="og:url" content="${escapeAttr(meta.url)}">`,
    `<meta property="og:image" content="${escapeAttr(meta.image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${escapeAttr(meta.imageAlt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(meta.description)}">`,
    `<meta name="twitter:image" content="${escapeAttr(meta.image)}">`,
  ]
  if (meta.oembedUrl) {
    tags.push(`<link rel="alternate" type="application/json+oembed" href="${escapeAttr(meta.oembedUrl)}">`)
  }
  if (meta.feedUrl) {
    tags.push(
      `<link rel="alternate" type="application/atom+xml" title="${escapeAttr(meta.title)}" href="${escapeAttr(meta.feedUrl)}">`,
    )
  }
  if (meta.jsonLd) tags.push(jsonLdScript(meta.jsonLd))
  return tags.join('\n    ')
}

/**
 * Inject share meta into an index.html template: replace the document title and
 * insert the meta block just before </head>. Idempotent-safe on any template
 * that has a single <title> and a </head>; falls back to appending if </head>
 * is somehow absent.
 */
export const injectShareMeta = (template: string, meta: ShareMeta): string => {
  const withTitle = template.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtmlText(meta.title)}</title>`,
  )
  const block = `    ${renderShareMetaTags(meta)}\n  </head>`
  return withTitle.includes('</head>') ? withTitle.replace('</head>', block) : `${withTitle}\n${block}`
}

/** Cap a description at a preview-friendly length, ending on a word boundary. */
const clampDescription = (value: string, max = 200): string => {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  const cut = trimmed.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

interface DashboardMetaInput {
  username: string
  name: string
  url: string
  /** Optional author-provided description. */
  description?: string
  /** On a period dashboard, the label of the period a visitor sees. */
  periodLabel?: string
}

/** A dashboard's name, with the period a visitor sees on a period dashboard. */
export const dashboardTitle = (name: string, periodLabel?: string): string =>
  periodLabel ? `${name} — ${periodLabel}` : name

export const buildDashboardShareMeta = ({
  username,
  name,
  url,
  description,
  periodLabel,
}: DashboardMetaInput): ShareMeta => ({
  description: clampDescription(
    // A stored empty/whitespace description (possible via the API) falls back.
    description?.trim()
      ? description
      : `${dashboardTitle(name, periodLabel)} — a public dashboard shared by ${username} on ${SITE_NAME}.`,
  ),
  image: resourceOgImage(url),
  imageAlt: `${SITE_NAME} dashboard: ${name}`,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name,
    url,
  },
  title: `${dashboardTitle(name, periodLabel)} — ${SITE_NAME}`,
  type: 'website',
  url,
})

interface ChallengeMetaInput {
  username: string
  name: string
  url: string
  details?: {
    measure: string
    range: string
    phrase: string
    status: ChallengeTimeStatus
    /** Members other than the host. */
    joined: number
    /** Every active member, host included. */
    participants: number
  }
}

const challengeDescription = ({ details, name, username }: ChallengeMetaInput): string => {
  if (!details) {
    return `${name} — a federated challenge hosted by ${username} on ${SITE_NAME}. Join from any Aurboda instance.`
  }
  const { joined, measure, participants, phrase, range, status } = details
  const lead = `${measure} challenge, ${range} · ${phrase}`
  if (status === 'ended') {
    const tookPart = participants === 0 ? '' : ` · ${participants} took part`
    return `${lead}${tookPart}. Hosted by ${username} on ${SITE_NAME}.`
  }
  const joinedText = joined === 0 ? 'Be the first to join' : `${joined} joined`
  return `${lead} · ${joinedText}. Hosted by ${username} on ${SITE_NAME} — join from any instance.`
}

export const buildChallengeShareMeta = (input: ChallengeMetaInput): ShareMeta => {
  const { name, url } = input
  return {
    description: clampDescription(challengeDescription(input)),
    image: resourceOgImage(url),
    imageAlt: `${SITE_NAME} challenge: ${name}`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name,
      url,
    },
    title: `${name} — ${SITE_NAME}`,
    type: 'website',
    url,
  }
}

interface ExerciseMetaInput {
  username: string
  name: string
  url: string
  /** The item value shared and its activity type's display name, for the image alt text. */
  value: string
  activityTypeName: string
}

export const buildExerciseShareMeta = ({
  activityTypeName,
  name,
  url,
  username,
  value,
}: ExerciseMetaInput): ShareMeta => ({
  description: clampDescription(`${name} — ${username}'s progress on ${SITE_NAME}.`),
  image: resourceOgImage(url),
  imageAlt: `${SITE_NAME} exercise: ${value} (${activityTypeName})`,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name,
    url,
  },
  title: `${name} — ${SITE_NAME}`,
  type: 'website',
  url,
})

interface ProfileMetaInput {
  username: string
  url: string
}

export const buildProfileShareMeta = ({ username, url }: ProfileMetaInput): ShareMeta => ({
  description: clampDescription(`${username}'s public dashboards and challenges on ${SITE_NAME}.`),
  image: resourceOgImage(url),
  imageAlt: `${SITE_NAME} profile: ${username}`,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: { '@type': 'Person', name: username },
    url,
  },
  title: `${username} — ${SITE_NAME}`,
  type: 'profile',
  url,
})

interface BlogMetaInput {
  username: string
  url: string
  profileUrl: string
  feedUrl: string
}

export const buildBlogShareMeta = ({ feedUrl, profileUrl, url, username }: BlogMetaInput): ShareMeta => ({
  description: clampDescription(`Articles by ${username} on ${SITE_NAME}.`),
  feedUrl,
  image: resourceOgImage(profileUrl),
  imageAlt: `${SITE_NAME} blog: ${username}`,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    author: { '@type': 'Person', name: username },
    name: `${username}'s blog`,
    url,
  },
  title: `${username}'s blog — ${SITE_NAME}`,
  type: 'website',
  url,
})

const listWords = (items: string[], conjunction: string): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}`

/** What the official feed lists, e.g. `Posts from fiddur and @bob@peer.example tagged #aurboda.` */
export const describeOfficialFeed = ({ remote_authors, tags, users }: OfficialFeedSetting): string =>
  `Posts from ${listWords([...users, ...remote_authors.map((author) => `@${author}`)], 'and')}${
    tags.length > 0
      ? ` tagged ${listWords(
          tags.map((tag) => `#${tag}`),
          'or',
        )}`
      : ''
  }.`

interface OfficialFeedMetaInput {
  webHost: string
  title: string
  setting: OfficialFeedSetting
  url: string
  feedUrl: string
}

export const buildOfficialFeedShareMeta = ({
  feedUrl,
  setting,
  title,
  url,
  webHost,
}: OfficialFeedMetaInput): ShareMeta => ({
  description: clampDescription(describeOfficialFeed(setting)),
  feedUrl,
  image: defaultOgImage(webHost),
  imageAlt: title,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: title,
    url,
  },
  title,
  type: 'website',
  url,
})

interface ArticleMetaInput {
  username: string
  title: string
  /** Plain-text excerpt of the article; empty falls back to a generic line. */
  excerpt: string
  url: string
  feedUrl: string
}

export const buildArticleShareMeta = ({
  excerpt,
  feedUrl,
  title,
  url,
  username,
}: ArticleMetaInput): ShareMeta => ({
  description: clampDescription(excerpt.trim() ? excerpt : `An article by ${username} on ${SITE_NAME}.`),
  feedUrl,
  image: resourceOgImage(url),
  imageAlt: `${SITE_NAME} article: ${title}`,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'Article',
    author: { '@type': 'Person', name: username },
    headline: title,
    url,
  },
  title: `${title} — ${SITE_NAME}`,
  type: 'article',
  url,
})

interface PostMetaInput {
  username: string
  title: string
  /** Plain text; empty falls back to a generic line. */
  description: string
  url: string
  /** When the post was published (ISO 8601). */
  createdAt: string
}

/** A non-article post's permalink: a social-media posting by its author. */
export const buildPostShareMeta = ({
  createdAt,
  description,
  title,
  url,
  username,
}: PostMetaInput): ShareMeta => ({
  description: clampDescription(description.trim() ? description : `A post by ${username} on ${SITE_NAME}.`),
  image: resourceOgImage(url),
  imageAlt: `${SITE_NAME} post: ${title}`,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'SocialMediaPosting',
    author: { '@type': 'Person', name: username },
    datePublished: createdAt,
    headline: title,
    url,
  },
  title: `${title} — ${SITE_NAME}`,
  type: 'article',
  url,
})

const DEFAULT_OG_IMAGE_ALT = `${SITE_NAME}: a dashboard and a day's timeline of sleep, heart rate and activities`

/** Generic meta for the site when no specific public resource is resolved. */
export const buildDefaultShareMeta = (webHost: string, url: string): ShareMeta => ({
  description: `${SITE_NAME} puts your sleep, training and everyday life on one private timeline. Open source.`,
  image: defaultOgImage(webHost),
  imageAlt: DEFAULT_OG_IMAGE_ALT,
  title: SITE_NAME,
  type: 'website',
  url,
})

export const buildHomeShareMeta = (webHost: string): ShareMeta => {
  const url = `${webHost.replace(/\/+$/, '')}/`
  return {
    description:
      `${SITE_NAME} collects what your watch, ring, phone and apps already know about you, puts it on one ` +
      'timeline, and shows what actually makes a difference. Open source, and private unless you share it.',
    image: defaultOgImage(webHost),
    imageAlt: DEFAULT_OG_IMAGE_ALT,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url,
    },
    title: `${SITE_NAME}: see how your sleep, training and everyday life fit together`,
    type: 'website',
    url,
  }
}
