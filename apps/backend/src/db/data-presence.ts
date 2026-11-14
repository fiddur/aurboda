import type { DataPresence } from '@aurboda/api-spec'

import { query } from './connection.ts'

/** One round trip: which of the asked metrics and activity types (with their subtypes) ever recorded anything. */
export const getDataPresence = async (
  user: string,
  metrics: string[],
  activityTypes: string[],
): Promise<DataPresence> => {
  const presence: DataPresence = {
    activity_types: Object.fromEntries(activityTypes.map((type) => [type, false])),
    metrics: Object.fromEntries(metrics.map((metric) => [metric, false])),
  }
  if (metrics.length === 0 && activityTypes.length === 0) return presence

  const result = await query(
    user,
    `WITH RECURSIVE tree AS (
       SELECT asked AS root, asked AS name FROM unnest($2::text[]) AS asked
       UNION
       SELECT tree.root, atd.name
         FROM activity_type_definitions atd
         JOIN tree ON atd.parent_type = tree.name
     )
     SELECT 'metric' AS kind, asked AS name
       FROM unnest($1::text[]) AS asked
      WHERE EXISTS (SELECT 1 FROM time_series ts WHERE ts.metric = asked AND ts.deleted_at IS NULL)
     UNION ALL
     SELECT 'activity_type', root
       FROM tree
      WHERE EXISTS (SELECT 1 FROM activities a WHERE a.activity_type = tree.name AND a.deleted_at IS NULL)
      GROUP BY root`,
    [metrics, activityTypes],
  )
  for (const row of result.rows) {
    const name = row.name as string
    if (row.kind === 'metric') presence.metrics[name] = true
    else presence.activity_types[name] = true
  }
  return presence
}
