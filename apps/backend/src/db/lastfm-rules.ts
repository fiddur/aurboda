/**
 * Last.fm auto-tagging rules CRUD.
 */
import { query } from './connection'
import { mapLastFmTagRuleRow } from './row-mappers'
import type { LastFmTagRule, LastFmTagRuleInput } from './types'

/**
 * Get all Last.fm tag rules for a user.
 */
export const getLastFmTagRules = async (user: string): Promise<LastFmTagRule[]> => {
  const result = await query(
    user,
    `SELECT id, rule_name, match_type, track_name, artist_name, match_mode, tag_name, created_at
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
    `INSERT INTO lastfm_tag_rules (rule_name, match_type, track_name, artist_name, match_mode, tag_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, rule_name, match_type, track_name, artist_name, match_mode, tag_name, created_at`,
    [
      rule.ruleName,
      rule.matchType,
      rule.trackName ?? null,
      rule.artistName ?? null,
      rule.matchMode ?? 'exact',
      rule.tagName,
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
