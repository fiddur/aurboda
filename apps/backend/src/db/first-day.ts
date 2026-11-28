import { categoryFirstSpanSql, subcategoryLikePattern } from '../services/screentime-sql.ts'
import { query } from './connection.ts'

const firstDayOf = async (user: string, sql: string, params: unknown[]): Promise<string | undefined> => {
  const result = await query<{ first_day: string | null }>(user, sql, params)
  return result.rows[0]?.first_day ?? undefined
}

const liveActivitySql = 'deleted_at IS NULL AND superseded_by IS NULL'

/** The first local day in `tz` of a live activity of one of `types`. */
export const getFirstActivityDay = (user: string, types: string[], tz: string): Promise<string | undefined> =>
  types.length === 0
    ? Promise.resolve(undefined)
    : firstDayOf(
        user,
        `SELECT to_char(min(start_time) AT TIME ZONE $2::text, 'YYYY-MM-DD') AS first_day
           FROM activities
          WHERE activity_type = ANY($1::text[]) AND ${liveActivitySql}`,
        [types, tz],
      )

/** The first local day in `tz` of a live activity whose type matches the case-insensitive regex `pattern`. */
export const getFirstActivityDayMatching = (
  user: string,
  pattern: string,
  tz: string,
): Promise<string | undefined> =>
  firstDayOf(
    user,
    `SELECT to_char(min(start_time) AT TIME ZONE $2::text, 'YYYY-MM-DD') AS first_day
       FROM activities
      WHERE activity_type ~* $1 AND ${liveActivitySql}`,
    [pattern, tz],
  )

/** The first local day in `tz` of a screentime span in the category path or one of its sub-categories. */
export const getFirstCategoryDay = (
  user: string,
  categoryPath: string,
  tz: string,
): Promise<string | undefined> =>
  firstDayOf(
    user,
    `SELECT to_char(first_day, 'YYYY-MM-DD') AS first_day FROM (${categoryFirstSpanSql('$1', '$2', '$3')}) f`,
    [categoryPath, tz, subcategoryLikePattern(categoryPath)],
  )

/** The first local day in `tz` of a live sample of `metric`, from `sources` only when given. */
export const getFirstMetricDay = (
  user: string,
  metric: string,
  sources: string[] | null,
  tz: string,
): Promise<string | undefined> =>
  firstDayOf(
    user,
    `SELECT to_char(min(time) AT TIME ZONE $2::text, 'YYYY-MM-DD') AS first_day
       FROM time_series
      WHERE metric = $1 AND deleted_at IS NULL${sources ? ' AND source = ANY($3::text[])' : ''}`,
    sources ? [metric, tz, sources] : [metric, tz],
  )
