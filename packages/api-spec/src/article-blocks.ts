import type { CorrelationSelector } from './schemas/correlations.ts'
import type { ArticleBlock, ArticleDraftBlock, ArticleDraftContent, ArticleWarning } from './schemas/feed.ts'

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')

/**
 * The one spelling of a public challenge link we store and compare by: no query
 * string or fragment (a pasted `?embed=1` link is the same challenge), no
 * trailing slashes, scheme and host lowercased, default port dropped. Null for
 * anything that isn't an http(s) URL.
 *
 * Everything that keys off a challenge URL — the joined-participation row, the
 * left-tombstone, discovery's "already mine" set — runs through this, so the
 * same challenge pasted two ways is still one challenge. Rows written before
 * this existed are not migrated; readers canonicalise what they load.
 */
export const canonicalChallengeUrl = (url: string): string | null => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  parsed.search = ''
  parsed.hash = ''
  return trimSlashes(parsed.toString())
}

export interface ParsedChallengeUrl {
  base: string
  username: string
  slug: string
}

/** Parse a public challenge URL `<base>/u/<username>/<slug>` (base may have a sub-path). */
export const parseChallengeUrl = (url: string): ParsedChallengeUrl | null => {
  const marker = '/u/'
  const i = url.indexOf(marker)
  if (i < 0) return null
  const base = trimSlashes(url.slice(0, i))
  const [username, slug] = url
    .slice(i + marker.length)
    .split('/')
    .filter(Boolean)
  if (!base || !username || !slug) return null
  return { base, slug, username }
}

/** A windowed block's effective window: its own override, else the article default. */
export const articleBlockWindow = (
  block: { start?: string; end?: string },
  content: { default_start?: string; default_end?: string },
): { start?: string; end?: string } => ({
  end: block.end ?? content.default_end,
  start: block.start ?? content.default_start,
})

const hasBoundedWindow = (
  block: { start?: string; end?: string },
  content: Pick<ArticleDraftContent, 'default_end' | 'default_start'>,
): boolean => {
  const { end, start } = articleBlockWindow(block, content)
  return start != null && end != null && new Date(start).getTime() < new Date(end).getTime()
}

/** A selector with something chosen: the editor leaves an empty metric or pattern in an unpicked one. */
const isChosen = (selector: CorrelationSelector | undefined): boolean => {
  if (selector === undefined) return false
  if (selector.kind === 'metric') return selector.metric.trim() !== ''
  if (selector.kind === 'sensitivity') return selector.flag.trim() !== ''
  return selector.kind === 'nutrition' || selector.pattern.trim() !== ''
}

const isChallengeUrl = (url: string | undefined): boolean =>
  url !== undefined && canonicalChallengeUrl(url) != null && parseChallengeUrl(url) != null

/**
 * Whether a draft block is complete enough to render as it would publish. The server's article
 * preview and the editor's own preview card both keep exactly the blocks this keeps.
 */
export const isCompleteArticleBlock = (
  block: ArticleDraftBlock,
  content: Pick<ArticleDraftContent, 'default_end' | 'default_start'>,
): block is ArticleBlock => {
  switch (block.type) {
    case 'prose':
      return true
    case 'challenge':
      return isChallengeUrl(block.challenge_url)
    case 'chart':
      return block.metric !== undefined && hasBoundedWindow(block, content)
    case 'correlation':
      return isChosen(block.trigger) && isChosen(block.outcome) && hasBoundedWindow(block, content)
    case 'impact':
      return Boolean(block.activity) && hasBoundedWindow(block, content)
  }
}

const blockFlagIds = (block: ArticleDraftBlock): string[] => {
  if (block.type === 'impact') {
    return block.activity_type === 'meal_sensitivity' && block.activity ? [block.activity] : []
  }
  if (block.type !== 'correlation') return []
  const ids = [block.trigger, block.outcome].flatMap((selector) =>
    selector?.kind === 'sensitivity' && selector.flag.trim() !== '' ? [selector.flag] : [],
  )
  return [...new Set(ids)]
}

/** The sensitivity flag ids an article's blocks name, each once, in block order. */
export const articleSensitivityFlagIds = (blocks: ArticleDraftBlock[]): string[] => [
  ...new Set(blocks.flatMap(blockFlagIds)),
]

const sensitivityPhrase = (name: string | undefined): string =>
  name ? `your meal sensitivity "${name}"` : 'a meal sensitivity flag'

/**
 * What an article's blocks show readers that the author may want to think twice about: each
 * meal sensitivity, by name. A warning, never a refusal; given whatever the visibility.
 */
export const articleSharingWarnings = (
  blocks: ArticleDraftBlock[],
  flagNames: Record<string, string>,
): ArticleWarning[] =>
  blocks.flatMap((block, index) =>
    blockFlagIds(block).map((id) => ({
      block: index,
      message:
        block.type === 'impact'
          ? `Readers see ${sensitivityPhrase(flagNames[id])} by name, and how your HRV, heart rate and stress moved around the meals that carried it.`
          : `Readers see ${sensitivityPhrase(flagNames[id])} by name, and how many meals carried it on each day of the window.`,
    })),
  )
