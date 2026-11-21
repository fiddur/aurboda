/**
 * Whether a root note's parent is live, for the alias `n` with a `parent_id` column (the uuid of
 * `entity_id` when it is one). A comment whose parent is soft-deleted (it reappears on restore) or
 * gone altogether would draw a Timeline bubble linking to something that 404s. The parent lookup is
 * a primary-key probe per row.
 */
export const PARENT_IS_LIVE = `CASE n.entity_type
       WHEN 'activity' THEN EXISTS (SELECT 1 FROM activities a WHERE a.id = n.parent_id AND a.deleted_at IS NULL)
       WHEN 'productivity' THEN EXISTS (SELECT 1 FROM productivity p WHERE p.id = n.parent_id AND p.deleted_at IS NULL)
       WHEN 'meal' THEN EXISTS (SELECT 1 FROM meals m WHERE m.id = n.parent_id)
       WHEN 'report' THEN EXISTS (SELECT 1 FROM reports r WHERE r.id = n.parent_id)
       ELSE TRUE
     END`

/** The CASE guards the uuid cast, since Postgres does not short-circuit a WHERE. */
export const parentIdColumn = (uuidParam: string): string =>
  `CASE WHEN n.entity_id ~* ${uuidParam} THEN n.entity_id::uuid END AS parent_id`
