/**
 * Matches screentime spans by category path, exact or as a prefix of a
 * sub-category. `data.category_path` alone marks a screentime span, so no
 * activity_type filter is needed: spans survive category deletion and legacy
 * `screentime` rows match under their own path, while non-screentime rows of a
 * type shared with a category stay out.
 */
export const categoryPathMatchSql = (paramIndex: number): string =>
  `(data->>'category_path' = $${paramIndex} OR starts_with(data->>'category_path', $${paramIndex} || ' > '))`

/**
 * The LIKE pattern for the sub-categories of a category path, its LIKE metacharacters escaped. Unlike
 * `starts_with`, a LIKE prefix can use the `(data->>'category_path') text_pattern_ops` index.
 */
export const subcategoryLikePattern = (categoryPath: string): string =>
  `${categoryPath.replaceAll(/[\\%_]/g, '\\$&')} > %`

const screentimeSpanFilterSql = `deleted_at IS NULL
            AND superseded_by IS NULL
            AND end_time IS NOT NULL`

/**
 * The first local day (in the zone bound to `tzParam`) of a category's spans (`pathParam`) and its sub-categories'
 * (`subcategoryPattern`), as `first_day`. A plain MIN over the LIKE match is planned as a walk of the time index,
 * which reads the whole table for a young or unknown category, and forcing the path index instead reads every
 * matching span. So this skips through the distinct sub-category paths in `idx_activities_category_path_start` order
 * and takes each path's earliest span from the same index.
 */
export const categoryFirstSpanSql = (
  pathParam: string,
  tzParam: string,
  subcategoryPattern: string,
): string => `
      WITH RECURSIVE sub_paths AS (
        (SELECT data->>'category_path' AS path
           FROM activities
          WHERE ${screentimeSpanFilterSql}
            AND data->>'category_path' LIKE ${subcategoryPattern}
          ORDER BY data->>'category_path' USING ~<~
          LIMIT 1)
        UNION ALL
        SELECT (SELECT data->>'category_path'
                  FROM activities
                 WHERE ${screentimeSpanFilterSql}
                   AND data->>'category_path' LIKE ${subcategoryPattern}
                   AND data->>'category_path' ~>~ sub_paths.path
                 ORDER BY data->>'category_path' USING ~<~
                 LIMIT 1)
          FROM sub_paths
         WHERE sub_paths.path IS NOT NULL
      ),
      paths AS (
        SELECT ${pathParam}::text AS path
        UNION ALL
        SELECT path FROM sub_paths WHERE path IS NOT NULL
      )
      SELECT (MIN((SELECT MIN(start_time)
                     FROM activities
                    WHERE ${screentimeSpanFilterSql}
                      AND data->>'category_path' = paths.path)) AT TIME ZONE ${tzParam}::text)::date AS first_day
        FROM paths`
