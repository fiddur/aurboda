/**
 * The type the merged view shows for activity row `alias`: a retype of a synced
 * row lives on its override, while the track, route and feature rows stay keyed
 * by the synced row.
 */
export const effectiveType = (alias: string): string => `COALESCE(
    (SELECT o.activity_type FROM activity_override_targets ot
     JOIN activities o ON o.id = ot.override_id AND o.deleted_at IS NULL
     WHERE ot.target_id = ${alias}.id LIMIT 1),
    ${alias}.activity_type)`
