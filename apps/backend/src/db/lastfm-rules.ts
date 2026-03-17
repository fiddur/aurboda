import type { LastFmTagRule, LastFmTagRuleInput } from './types.ts'

/**
 * Last.fm auto-tagging rules CRUD.
 */
import { query } from './connection.ts'
import { mapLastFmTagRuleRow } from './row-mappers.ts'

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
 * Update a Last.fm tag rule by ID.
 */
type UpdateLastFmTagRuleInput = Omit<Partial<LastFmTagRuleInput>, 'merge_gap_seconds'> & {
  merge_gap_seconds?: number | null
}

export const updateLastFmTagRule = async (
  user: string,
  ruleId: string,
  rule: UpdateLastFmTagRuleInput,
): Promise<LastFmTagRule | null> => {
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (rule.rule_name !== undefined) {
    setClauses.push(`rule_name = $${paramIndex++}`)
    values.push(rule.rule_name)
  }
  if (rule.match_type !== undefined) {
    setClauses.push(`match_type = $${paramIndex++}`)
    values.push(rule.match_type)
  }
  if (rule.track_name !== undefined) {
    setClauses.push(`track_name = $${paramIndex++}`)
    values.push(rule.track_name || null)
  }
  if (rule.artist_name !== undefined) {
    setClauses.push(`artist_name = $${paramIndex++}`)
    values.push(rule.artist_name || null)
  }
  if (rule.artist_names !== undefined) {
    setClauses.push(`artist_names = $${paramIndex++}`)
    values.push(rule.artist_names ? JSON.stringify(rule.artist_names) : null)
  }
  if (rule.match_mode !== undefined) {
    setClauses.push(`match_mode = $${paramIndex++}`)
    values.push(rule.match_mode)
  }
  if (rule.tag_name !== undefined) {
    setClauses.push(`tag_name = $${paramIndex++}`)
    values.push(rule.tag_name)
  }
  if (rule.merge_gap_seconds !== undefined) {
    setClauses.push(`merge_gap_seconds = $${paramIndex++}`)
    values.push(rule.merge_gap_seconds ?? null)
  }

  if (setClauses.length === 0) return null

  values.push(ruleId)

  const result = await query(
    user,
    `UPDATE lastfm_tag_rules
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING ${LASTFM_RULE_COLUMNS}`,
    values,
  )

  if (result.rows.length === 0) return null
  return mapLastFmTagRuleRow(result.rows[0])
}

/**
 * Delete a Last.fm tag rule by ID.
 */
export const deleteLastFmTagRule = async (user: string, ruleId: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM lastfm_tag_rules WHERE id = $1`, [ruleId])
  return (result.rowCount ?? 0) > 0
}
