/**
 * Host-set challenge banner images, one per challenge, stored in the host's own
 * database (the deployment has no object store; only Postgres persists).
 */
import { query } from './connection.ts'

export interface ChallengeBanner {
  content_type: string
  data: Buffer
  updated_at: Date
}

export const getChallengeBanner = async (
  user: string,
  challengeId: string,
): Promise<ChallengeBanner | undefined> => {
  const result = await query(
    user,
    `SELECT content_type, data, updated_at FROM challenge_banner WHERE challenge_id = $1`,
    [challengeId],
  )
  if (result.rows.length === 0) return undefined
  return {
    content_type: result.rows[0].content_type as string,
    data: result.rows[0].data as Buffer,
    updated_at: result.rows[0].updated_at as Date,
  }
}

export const upsertChallengeBanner = async (
  user: string,
  challengeId: string,
  contentType: string,
  data: Buffer,
): Promise<void> => {
  await query(
    user,
    `INSERT INTO challenge_banner (challenge_id, content_type, data, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (challenge_id)
     DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, updated_at = NOW()`,
    [challengeId, contentType, data],
  )
}

export const deleteChallengeBanner = async (user: string, challengeId: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM challenge_banner WHERE challenge_id = $1`, [challengeId])
  return (result.rowCount ?? 0) > 0
}
