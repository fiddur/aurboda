/**
 * Matches screentime spans by category path, exact or as a prefix of a
 * sub-category. `data.category_path` alone marks a screentime span, so no
 * activity_type filter is needed: spans survive category deletion and legacy
 * `screentime` rows match under their own path, while non-screentime rows of a
 * type shared with a category stay out.
 */
export const categoryPathMatchSql = (paramIndex: number): string =>
  `(data->>'category_path' = $${paramIndex} OR starts_with(data->>'category_path', $${paramIndex} || ' > '))`
