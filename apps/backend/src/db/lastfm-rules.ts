/**
 * Last.fm auto-tagging rules CRUD.
 */
import { query } from './connection'
import { mapLastFmTagRuleRow } from './row-mappers'
import type { LastFmTagRule, LastFmTagRuleInput } from './types'

const LASTFM_RULE_COLUMNS = `id, rule_name, match_type, track_name, artist_name, match_mode, tag_name,
     merge_gap_seconds, artist_names, created_at`

/**
 * Get all Last.fm tag rules for a user.
 */
export const getLastFmTagRules = async (user: string): Promise<LastFmTagRule[]> => {
  const result = await query(
    user,
    `SELECT ${LASTFM_RULE_COLUMNS}
     FROM lastfm_tag_rules
     ORDER BY created_at DESC`,
  )

  return result.rows.map(mapLastFmTagRuleRow)
}

/**
 * Insert a new Last.fm tag rule.
 */
export const insertLastFmTagRule = async (user: string, rule: LastFmTagRuleInput): Promise<LastFmTagRule> => {
  const result = await query(
    user,
    `INSERT INTO lastfm_tag_rules (rule_name, match_type, track_name, artist_name, match_mode, tag_name,
       merge_gap_seconds, artist_names)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${LASTFM_RULE_COLUMNS}`,
    [
      rule.rule_name,
      rule.match_type,
      rule.track_name ?? null,
      rule.artist_name ?? null,
      rule.match_mode ?? 'exact',
      rule.tag_name,
      rule.merge_gap_seconds ?? null,
      rule.artist_names ? JSON.stringify(rule.artist_names) : null,
    ],
  )

  return mapLastFmTagRuleRow(result.rows[0])
}

/**
 * Delete a Last.fm tag rule by ID.
 */
export const deleteLastFmTagRule = async (user: string, ruleId: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM lastfm_tag_rules WHERE id = $1`, [ruleId])
  return (result.rowCount ?? 0) > 0
}
