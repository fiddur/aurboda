/**
 * SQL predicate operand matching every activity type a screentime span can be
 * stored under: the per-category derived types plus the legacy umbrella
 * `screentime` type. Pair it with a `data->>'category_path'` condition — a
 * category may link to a pre-existing type that also holds non-screentime rows.
 */
export const SCREENTIME_ACTIVITY_TYPES_SQL = `(
  SELECT activity_type_name FROM screentime_categories WHERE activity_type_name IS NOT NULL
  UNION ALL SELECT 'screentime'
)`
