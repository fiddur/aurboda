/**
 * The article block images whose render found no data (a sparse block → 404),
 * remembered for the hour so a public sparse block doesn't re-run the render on
 * every unauthenticated hit. Shared between the image routes and the markdown
 * export: when the export finds a block drawable it forgets that block's misses,
 * so the link it emits doesn't keep 404ing until the hour rolls over.
 */

export const createNegativeCache = (maxEntries = 500) => {
  const seen = new Map<string, true>()
  return {
    add: (key: string) => {
      if (seen.size >= maxEntries) {
        const oldest = seen.keys().next().value
        if (oldest !== undefined) seen.delete(oldest)
      }
      seen.set(key, true)
    },
    forgetPrefix: (prefix: string) => {
      for (const key of seen.keys()) if (key.startsWith(prefix)) seen.delete(key)
    },
    has: (key: string) => seen.has(key),
  }
}

export type NegativeCache = ReturnType<typeof createNegativeCache>

export type BlockImageKind = 'blockfig' | 'blockpng' | 'blocksvg'

const HOUR_MS = 3_600_000

/**
 * The render-cache key of one article block image. It includes the post's
 * `updated_at` (an edit re-renders) and a time bucket, hourly unless given (a
 * window that later gains data re-renders within the hour; a challenge block's
 * standings use a finer one); the index is the normalised number, so
 * equivalent spellings in the URL share one entry.
 */
export const articleBlockCacheKey = (
  kind: BlockImageKind,
  username: string,
  postId: string,
  index: number,
  updatedAt: Date,
  bucketMs: number = HOUR_MS,
): string =>
  `${kind}:${username}:${postId}:${index}:${updatedAt.getTime()}:${Math.floor(Date.now() / bucketMs)}`

/** Forget every remembered miss of one block, in every image kind. */
export const forgetArticleBlockMisses = (
  misses: NegativeCache,
  username: string,
  postId: string,
  index: number,
): void => {
  for (const kind of ['blockfig', 'blockpng', 'blocksvg'] as const) {
    misses.forgetPrefix(`${kind}:${username}:${postId}:${index}:`)
  }
}

export const articleBlockMisses = createNegativeCache()
