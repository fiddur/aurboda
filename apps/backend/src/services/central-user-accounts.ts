import type { Queryable } from '../db/pool.ts'

export interface UserAccount {
  username: string
  /** `null` for an account that existed before signup dates were tracked. */
  created_at: Date | null
  pre_existing: boolean
  inserted_at: Date
}

export const CREATE_USER_ACCOUNTS_TABLE = `
  CREATE TABLE IF NOT EXISTS user_accounts (
    username     VARCHAR(255) PRIMARY KEY,
    created_at   TIMESTAMPTZ,
    pre_existing BOOLEAN NOT NULL DEFAULT FALSE,
    inserted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

const COLUMNS = 'username, created_at, pre_existing, inserted_at'

const mapRow = (row: Record<string, unknown>): UserAccount => ({
  created_at: row.created_at ? new Date(row.created_at as string) : null,
  inserted_at: new Date(row.inserted_at as string),
  pre_existing: row.pre_existing as boolean,
  username: row.username as string,
})

export interface UserAccountsApi {
  /** Inserts the row unless one exists. Resolves to whether it inserted. */
  ensureUserAccount: (
    username: string,
    options: { createdAt: Date | null; preExisting: boolean },
  ) => Promise<boolean>
  /** Inserts a pre-existing row, without a signup date, for each name that has none. Resolves to the count inserted. */
  backfillUserAccounts: (usernames: string[]) => Promise<number>
  getUserAccount: (username: string) => Promise<UserAccount | null>
  listUserAccounts: () => Promise<UserAccount[]>
  deleteUserAccount: (username: string) => Promise<boolean>
}

export const createUserAccountsApi = (getClient: () => Promise<Queryable>): UserAccountsApi => ({
  backfillUserAccounts: async (usernames) => {
    if (usernames.length === 0) return 0
    const client = await getClient()
    const result = await client.query(
      `INSERT INTO user_accounts (username, created_at, pre_existing)
       SELECT name, NULL, TRUE FROM unnest($1::text[]) AS name
       ON CONFLICT (username) DO NOTHING`,
      [usernames],
    )
    return result.rowCount ?? 0
  },

  deleteUserAccount: async (username) => {
    const client = await getClient()
    const result = await client.query('DELETE FROM user_accounts WHERE username = $1', [username])
    return (result.rowCount ?? 0) > 0
  },

  ensureUserAccount: async (username, { createdAt, preExisting }) => {
    const client = await getClient()
    const result = await client.query(
      `INSERT INTO user_accounts (username, created_at, pre_existing)
       VALUES ($1, $2, $3)
       ON CONFLICT (username) DO NOTHING`,
      [username, createdAt, preExisting],
    )
    return (result.rowCount ?? 0) > 0
  },

  getUserAccount: async (username) => {
    const client = await getClient()
    const result = await client.query(`SELECT ${COLUMNS} FROM user_accounts WHERE username = $1`, [username])
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  listUserAccounts: async () => {
    const client = await getClient()
    const result = await client.query(`SELECT ${COLUMNS} FROM user_accounts ORDER BY username`)
    return result.rows.map(mapRow)
  },
})
