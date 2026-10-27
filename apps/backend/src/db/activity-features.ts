import {
  type ActivityFeatureName,
  activityFeatureNameSchema,
  type ActivityFeatureOperator,
  type ActivityFeatures,
} from '@aurboda/api-spec'

import { query } from './connection.ts'
import { effectiveType } from './effective-type.ts'

export type ActivityFeatureValues = Omit<ActivityFeatures, 'activity_id' | 'computed_at'>

const featureColumns = activityFeatureNameSchema.options

const operatorSql: Record<ActivityFeatureOperator, string> = { gt: '>', gte: '>=', lt: '<', lte: '<=' }

const ONE_HOUR_MS = 3_600_000

export const upsertActivityFeatures = async (
  user: string,
  activityId: string,
  features: ActivityFeatureValues,
): Promise<void> => {
  const placeholders = featureColumns.map((_, i) => `$${i + 2}`)
  await query(
    user,
    `INSERT INTO activity_features (activity_id, ${featureColumns.join(', ')}, computed_at)
     VALUES ($1, ${placeholders.join(', ')}, NOW())
     ON CONFLICT (activity_id) DO UPDATE SET
       ${featureColumns.map((c) => `${c} = EXCLUDED.${c}`).join(',\n       ')},
       computed_at = NOW()`,
    [activityId, ...featureColumns.map((c) => features[c])],
  )
}

const toNumberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value)

export const getActivityFeatures = async (
  user: string,
  activityId: string,
): Promise<ActivityFeatures | null> => {
  const result = await query(
    user,
    `SELECT activity_id, ${featureColumns.join(', ')}, computed_at FROM activity_features WHERE activity_id = $1`,
    [activityId],
  )
  const row = result.rows[0]
  if (!row) return null
  const features = Object.fromEntries(featureColumns.map((c) => [c, toNumberOrNull(row[c])])) as Record<
    ActivityFeatureName,
    number | null
  >
  return {
    ...features,
    activity_id: row.activity_id as string,
    computed_at: (row.computed_at as Date).toISOString(),
  }
}

export const deleteAllActivityFeatures = async (user: string): Promise<number> => {
  const result = await query(user, `DELETE FROM activity_features`)
  return result.rowCount ?? 0
}

export const listTrackedActivitiesWithoutFeatures = async (
  user: string,
): Promise<{ activity_id: string }[]> => {
  const result = await query<{ activity_id: string }>(
    user,
    `SELECT a.id AS activity_id FROM activities a
     WHERE a.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM activity_tracks t WHERE t.activity_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM activity_features f WHERE f.activity_id = a.id)
     ORDER BY a.start_time, a.id`,
  )
  return result.rows
}

export const getMedianDurationBefore = async (
  user: string,
  activityTypes: string[],
  before: Date,
  days = 90,
): Promise<number | null> => {
  if (activityTypes.length === 0) return null
  const result = await query<{ median: number | null }>(
    user,
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM end_time - start_time)) AS median
     FROM activities
     WHERE activity_type = ANY($1)
       AND deleted_at IS NULL
       AND superseded_by IS NULL
       AND end_time IS NOT NULL
       AND start_time >= $2
       AND start_time < $3`,
    [activityTypes, new Date(before.getTime() - days * 24 * ONE_HOUR_MS), before],
  )
  return toNumberOrNull(result.rows[0]?.median)
}

export const findActivitiesByFeature = async (
  user: string,
  activityTypes: string[],
  feature: ActivityFeatureName,
  operator: ActivityFeatureOperator,
  value: number,
  window: { start: Date; end: Date },
): Promise<{ id: string; start: Date; end: Date; value: number }[]> => {
  if (activityTypes.length === 0) return []
  if (!featureColumns.includes(feature)) return []
  const comparison = operatorSql[operator]
  if (!comparison) return []
  const result = await query(
    user,
    `SELECT a.id, a.start_time, a.end_time, f.${feature} AS value
     FROM activities a
     JOIN activity_features f ON f.activity_id = a.id
     WHERE ${effectiveType('a')} = ANY($1)
       AND a.deleted_at IS NULL
       AND a.start_time < $3
       AND COALESCE(a.end_time, a.start_time + INTERVAL '1 hour') > $2
       AND f.${feature} ${comparison} $4
     ORDER BY a.start_time`,
    [activityTypes, window.start, window.end, value],
  )
  return result.rows.map((row) => {
    const start = row.start_time as Date
    return {
      end: (row.end_time as Date | null) ?? new Date(start.getTime() + ONE_HOUR_MS),
      id: row.id as string,
      start,
      value: Number(row.value),
    }
  })
}
