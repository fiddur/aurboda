import type { Queryable } from '../db/pool.ts'

/**
 * A deleted account's username stays here for good. Remote ActivityPub servers
 * cache an actor and its key by URL, so a new account under the same name would
 * inherit the old one's followers and trust.
 */
export const CREATE_DELETED_USERNAMES_TABLE = `
  CREATE TABLE IF NOT EXISTS deleted_usernames (
    username   VARCHAR(255) PRIMARY KEY,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_by VARCHAR(255) NOT NULL
  )
`

type CentralUserDelete = (tx: Queryable, username: string) => Promise<number>

const deleteWhereUsername =
  (table: string): CentralUserDelete =>
  async (tx, username) =>
    (await tx.query(`DELETE FROM ${table} WHERE username = $1`, [username])).rowCount ?? 0

export const deleteAdminRow = deleteWhereUsername('admins')
export const deleteOAuthAuthorizationCodes = deleteWhereUsername('oauth_authorization_codes')
export const deleteOAuthTokens = deleteWhereUsername('oauth_tokens')
export const deleteWebAuthnUserHandleRow = deleteWhereUsername('webauthn_user_handles')
export const deleteOuraUserMappingRows = deleteWhereUsername('oura_user_mappings')
export const deleteStravaAthleteMappingRows = deleteWhereUsername('strava_athlete_mappings')
export const deleteUserAccountRow = deleteWhereUsername('user_accounts')
export const deleteUserUsageRows = deleteWhereUsername('user_usage_daily')

/** Import jobs are shared library history: the job stays, the name of who started it goes. */
export const forgetImportJobStarter: CentralUserDelete = async (tx, username) =>
  (await tx.query('UPDATE import_jobs SET started_by = NULL WHERE started_by = $1', [username])).rowCount ?? 0

/** The user's own posts on the public tag pages; remote posts carry no local user. */
export const deleteLocalPublicTagPosts: CentralUserDelete = async (tx, username) =>
  (await tx.query('DELETE FROM public_tag_posts WHERE local_user = $1', [username])).rowCount ?? 0

export const CENTRAL_USER_DELETES: Record<string, CentralUserDelete> = {
  admins: deleteAdminRow,
  import_jobs: forgetImportJobStarter,
  oauth_authorization_codes: deleteOAuthAuthorizationCodes,
  oauth_tokens: deleteOAuthTokens,
  oura_user_mappings: deleteOuraUserMappingRows,
  public_tag_posts: deleteLocalPublicTagPosts,
  strava_athlete_mappings: deleteStravaAthleteMappingRows,
  user_accounts: deleteUserAccountRow,
  user_usage_daily: deleteUserUsageRows,
  webauthn_user_handles: deleteWebAuthnUserHandleRow,
}

export interface DeletedUsernamesApi {
  /** Reserves the name for good. Resolves to false when it was already reserved. */
  reserveDeletedUsername: (username: string, deletedBy: string) => Promise<boolean>
  isUsernameDeleted: (username: string) => Promise<boolean>
  listDeletedUsernames: () => Promise<string[]>
  /** Removes every central row that names the user, in one transaction. Resolves to the rows touched per table. */
  deleteAllCentralUserData: (username: string) => Promise<Record<string, number>>
}

export const createDeletedUsernamesApi = (
  getClient: () => Promise<Queryable>,
  withTransaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>,
): DeletedUsernamesApi => ({
  deleteAllCentralUserData: (username) =>
    withTransaction(async (tx) => {
      const counts: Record<string, number> = {}
      for (const [table, remove] of Object.entries(CENTRAL_USER_DELETES)) {
        counts[table] = await remove(tx, username)
      }
      return counts
    }),

  isUsernameDeleted: async (username) => {
    const client = await getClient()
    const result = await client.query('SELECT 1 FROM deleted_usernames WHERE username = $1', [username])
    return result.rows.length > 0
  },

  listDeletedUsernames: async () => {
    const client = await getClient()
    const result = await client.query<{ username: string }>(
      'SELECT username FROM deleted_usernames ORDER BY username',
    )
    return result.rows.map((row) => row.username)
  },

  reserveDeletedUsername: async (username, deletedBy) => {
    const client = await getClient()
    const result = await client.query(
      `INSERT INTO deleted_usernames (username, deleted_by) VALUES ($1, $2)
       ON CONFLICT (username) DO NOTHING`,
      [username, deletedBy],
    )
    return (result.rowCount ?? 0) > 0
  },
})
