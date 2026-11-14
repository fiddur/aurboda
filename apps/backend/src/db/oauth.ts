import type { OAuthToken } from './types.ts'

import { query } from './connection.ts'

export const upsertOAuthToken = async (user: string, token: OAuthToken) => {
  await query(
    user,
    `INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, scopes, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (provider) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scopes = EXCLUDED.scopes,
       refused_at = NULL,
       updated_at = NOW()`,
    [token.provider, token.access_token, token.refresh_token, token.expires_at, token.scopes],
  )
}

export const getOAuthToken = async (user: string, provider: string): Promise<OAuthToken | null> => {
  const result = await query(
    user,
    `SELECT provider, access_token, refresh_token, expires_at, scopes, refused_at
     FROM oauth_tokens
     WHERE provider = $1`,
    [provider],
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  return {
    access_token: row.access_token,
    expires_at: row.expires_at ? new Date(row.expires_at) : undefined,
    provider: row.provider,
    refresh_token: row.refresh_token,
    refused_at: row.refused_at ? new Date(row.refused_at) : undefined,
    scopes: row.scopes,
  }
}

/** With `refreshToken`, only a row still holding that token is marked, so a key replaced meanwhile stays unflagged. */
export const markOAuthTokenRefused = async (
  user: string,
  provider: string,
  refreshToken?: string,
): Promise<void> => {
  if (refreshToken === undefined) {
    await query(user, `UPDATE oauth_tokens SET refused_at = NOW(), updated_at = NOW() WHERE provider = $1`, [
      provider,
    ])
    return
  }
  await query(
    user,
    `UPDATE oauth_tokens SET refused_at = NOW(), updated_at = NOW() WHERE provider = $1 AND refresh_token = $2`,
    [provider, refreshToken],
  )
}

/** Stores a fresh access token only while the row still holds `refreshToken`; a replaced key is left as it is. */
export const updateOAuthAccessToken = async (
  user: string,
  provider: string,
  refreshToken: string,
  accessToken: string,
): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE oauth_tokens SET access_token = $3, updated_at = NOW() WHERE provider = $1 AND refresh_token = $2`,
    [provider, refreshToken, accessToken],
  )
  return (result.rowCount ?? 0) > 0
}

export const deleteOAuthToken = async (user: string, provider: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM oauth_tokens WHERE provider = $1`, [provider])
  return (result.rowCount ?? 0) > 0
}
