/**
 * Nightly upkeep of the posts the instance actor's tag follows bring in: the
 * follows are re-applied first (re-sending pending ones and retrying unresolved
 * ones), then posts older than the retention are dropped, except the official
 * feed's, and so are posts that carry none of the followed tags.
 */
import type { PublicTagPruneKeep } from './central-public-tags.ts'
import type { PgBoss } from './pg-boss.ts'

const QUEUE_NAME = 'public-tag-posts-prune'

export const PUBLIC_TAG_PRUNE_CRON = '23 3 * * *'

const DAY_MS = 24 * 60 * 60 * 1000

export interface PublicTagPruneDeps {
  retentionDays: () => Promise<number>
  /** The public tag pages' tags and the official feed's (`readInstanceFollowedTags`). */
  followedTags: () => Promise<string[]>
  /** The official feed's remote posts, kept regardless of the retention. */
  officialFeedKeep: () => Promise<PublicTagPruneKeep>
  /** Brings the instance actor's tag follows in line with `followedTags`; a failure does not stop the prune. */
  refollow?: (tags: string[]) => Promise<unknown>
  prune: (olderThan: Date, keep: PublicTagPruneKeep) => Promise<number>
  pruneNotTagged: (tags: string[]) => Promise<number>
  now?: () => Date
  onRefollowError?: (error: unknown) => void
}

/** Resolves to the number of posts dropped. */
export const prunePublicTagPages = async (deps: PublicTagPruneDeps): Promise<number> => {
  const now = deps.now?.() ?? new Date()
  const [retentionDays, tags, keep] = await Promise.all([
    deps.retentionDays(),
    deps.followedTags(),
    deps.officialFeedKeep(),
  ])
  await deps.refollow?.(tags).catch((error: unknown) => deps.onRefollowError?.(error))
  const old = await deps.prune(new Date(now.getTime() - retentionDays * DAY_MS), keep)
  const untagged = await deps.pruneNotTagged(tags)
  return old + untagged
}

/* v8 ignore start -- requires real pg-boss instance */
export const createPublicTagPruneQueue = async (boss: PgBoss, deps: PublicTagPruneDeps): Promise<void> => {
  await boss.createQueue(QUEUE_NAME)
  await boss.schedule(QUEUE_NAME, PUBLIC_TAG_PRUNE_CRON)
  await boss.work(QUEUE_NAME, { batchSize: 1, pollingIntervalSeconds: 60 }, async () => {
    const pruned = await prunePublicTagPages(deps)
    console.info(`🧹 Pruned ${pruned} public tag page post(s)`)
  })
  console.info(`🧹 Public tag page prune scheduled (${PUBLIC_TAG_PRUNE_CRON})`)
}
/* v8 ignore stop */
