/**
 * Server-rendered <head> metadata for public share pages.
 *
 * JS-less crawlers (Facebook, Slack, LinkedIn, Discord, iMessage) never execute
 * the SPA, so they only see whatever `<head>` the server sends. These pure
 * helpers build Open Graph / Twitter Card / description meta (plus schema.org
 * JSON-LD) for a public resource and inject it into the SPA's index.html
 * template. The body stays a client-rendered SPA; only the head is enriched.
 *
 * Everything here is a pure function of already-resolved, non-sensitive data —
 * callers must resolve visibility first and never pass a private resource in.
 */

/** Human-facing site name used across meta tags. */
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
  /** Alt text for the preview image. */
  imageAlt: string
  /** Open Graph object type. */
  type: 'website' | 'profile'
  /** Optional schema.org JSON-LD object embedded as a <script> tag. */
  jsonLd?: Record<string, unknown>
}

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
  /** Optional author-provided description (added in a later iteration). */
  description?: string
}

/** Build share meta for a public shared dashboard. */
export const buildDashboardShareMeta = ({
  username,
  name,
  url,
  description,
}: DashboardMetaInput): ShareMeta => ({
  description: clampDescription(
    // A stored empty/whitespace description (possible via the API) falls back.
    description?.trim() ? description : `${name} — a public dashboard shared by ${username} on ${SITE_NAME}.`,
  ),
  image: resourceOgImage(url),
  imageAlt: `${SITE_NAME} dashboard: ${name}`,
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

interface ChallengeMetaInput {
  username: string
  name: string
  url: string
}

/** Build share meta for a public federated challenge. */
export const buildChallengeShareMeta = ({ username, name, url }: ChallengeMetaInput): ShareMeta => ({
  description: clampDescription(
    `${name} — a federated challenge hosted by ${username} on ${SITE_NAME}. Join from any Aurboda instance.`,
  ),
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
})

interface ProfileMetaInput {
  username: string
  url: string
}

/** Build share meta for a public profile / actor page. */
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

/** Generic meta for the site when no specific public resource is resolved. */
export const buildDefaultShareMeta = (webHost: string, url: string): ShareMeta => ({
  description: `${SITE_NAME} — a self-hosted self-quantification aggregator.`,
  image: defaultOgImage(webHost),
  imageAlt: SITE_NAME,
  title: SITE_NAME,
  type: 'website',
  url,
})
