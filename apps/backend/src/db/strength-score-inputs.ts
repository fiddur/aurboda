import { query } from './connection.ts'

export interface ChangeAggregate {
  changed_at: string | null
  count: number
}

export interface StrengthScoreInputAggregates {
  activities: ChangeAggregate
  item_value_aliases: ChangeAggregate
  item_value_identities: ChangeAggregate
  shared_exercises: ChangeAggregate
  weight: ChangeAggregate & { deleted: number }
}

interface Row {
  activities_changed_at: string | null
  activities_count: number
  aliases_changed_at: string | null
  aliases_count: number
  identities_changed_at: string | null
  identities_count: number
  shared_changed_at: string | null
  shared_count: number
  weight_changed_at: string | null
  weight_count: number
  weight_deleted: number
}

/**
 * Counts and latest change times of everything a strength score is calculated from. Deleted and superseded activities
 * count too, and timestamps keep their microseconds as text, so any change to an input changes the result.
 */
export const getStrengthScoreInputAggregates = async (
  user: string,
  activityTypes: readonly string[],
): Promise<StrengthScoreInputAggregates> => {
  const result = await query<Row>(
    user,
    `SELECT a.count AS activities_count, a.changed_at AS activities_changed_at,
            w.count AS weight_count, w.deleted AS weight_deleted, w.changed_at AS weight_changed_at,
            i.count AS identities_count, i.changed_at AS identities_changed_at,
            al.count AS aliases_count, al.changed_at AS aliases_changed_at,
            s.count AS shared_count, s.changed_at AS shared_changed_at
       FROM (SELECT COUNT(*)::int AS count, MAX(COALESCE(updated_at, created_at))::text AS changed_at
               FROM activities WHERE activity_type = ANY($1::text[])) a,
            (SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS count,
                    COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted,
                    MAX(updated_at)::text AS changed_at
               FROM time_series WHERE metric = 'weight') w,
            (SELECT COUNT(*)::int AS count, MAX(updated_at)::text AS changed_at FROM item_value_identities) i,
            (SELECT COUNT(*)::int AS count, MAX(created_at)::text AS changed_at FROM item_value_aliases) al,
            (SELECT COUNT(*)::int AS count, MAX(updated_at)::text AS changed_at FROM shared_exercises) s`,
    [activityTypes],
  )
  const row = result.rows[0] as Row
  return {
    activities: { changed_at: row.activities_changed_at, count: row.activities_count },
    item_value_aliases: { changed_at: row.aliases_changed_at, count: row.aliases_count },
    item_value_identities: { changed_at: row.identities_changed_at, count: row.identities_count },
    shared_exercises: { changed_at: row.shared_changed_at, count: row.shared_count },
    weight: { changed_at: row.weight_changed_at, count: row.weight_count, deleted: row.weight_deleted },
  }
}
