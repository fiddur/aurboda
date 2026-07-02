/**
 * Intra-batch dedupe for upserts.
 *
 * Postgres' `ON CONFLICT DO UPDATE` can only touch each existing row once per
 * command, so a batch that contains two rows hitting the same conflict key
 * raises `21000: ON CONFLICT DO UPDATE command cannot affect row a second time`.
 * This collapses such batches to one row per key (last write wins, matching
 * upsert semantics) before they reach the DB.
 */

/**
 * Keep the last item per key, preserving first-seen order. Items whose `keyFn`
 * returns `null` are never deduped — use this for rows that don't collide in the
 * unique index (e.g. a NULL `external_id`, which Postgres treats as distinct).
 */
export const dedupeLastWins = <T>(items: T[], keyFn: (item: T) => string | null): T[] => {
  const out: T[] = []
  const indexByKey = new Map<string, number>()
  for (const item of items) {
    const key = keyFn(item)
    if (key === null) {
      out.push(item)
      continue
    }
    const existing = indexByKey.get(key)
    if (existing === undefined) {
      indexByKey.set(key, out.length)
      out.push(item)
    } else {
      out[existing] = item
    }
  }
  return out
}
