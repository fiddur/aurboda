/**
 * Nightly pruning of the public tag pages: posts older than the retention, and
 * posts that carry none of the tags that still have a page.
 */
import type { PgBoss } from './pg-boss.ts'

const QUEUE_NAME = 'public-tag-posts-prune'

export const PUBLIC_TAG_PRUNE_CRON = '23 3 * * *'

const DAY_MS = 24 * 60 * 60 * 1000

export interface PublicTagPruneDeps {
  retentionDays: () => Promise<number>
  publicTagPages: () => Promise<string[]>
  prune: (olderThan: Date) => Promise<number>
  pruneNotTagged: (tags: string[]) => Promise<number>
  now?: () => Date
}

/** Resolves to the number of posts dropped. */
export const prunePublicTagPages = async (deps: PublicTagPruneDeps): Promise<number> => {
  const now = deps.now?.() ?? new Date()
  const [retentionDays, tags] = await Promise.all([deps.retentionDays(), deps.publicTagPages()])
  const old = await deps.prune(new Date(now.getTime() - retentionDays * DAY_MS))
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
