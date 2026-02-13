/**
 * OAuth token storage and retrieval.
 */
import { query } from './connection'
import type { OAuthToken } from './types'

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
       updated_at = NOW()`,
    [token.provider, token.accessToken, token.refreshToken, token.expiresAt, token.scopes],
  )
}

export const getOAuthToken = async (user: string, provider: string): Promise<OAuthToken | null> => {
  const result = await query(
    user,
    `SELECT provider, access_token, refresh_token, expires_at, scopes
     FROM oauth_tokens
     WHERE provider = $1`,
    [provider],
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  return {
    accessToken: row.access_token,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    provider: row.provider,
    refreshToken: row.refresh_token,
    scopes: row.scopes,
  }
}
