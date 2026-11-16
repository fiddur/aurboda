import type { AccountPlan } from '@aurboda/api-spec'

import type { Queryable } from '../db/pool.ts'

export interface UserAccount {
  username: string
  /** `null` for an account that existed before signup dates were tracked. */
  created_at: Date | null
  pre_existing: boolean
  inserted_at: Date
  /** `null` for an account billing has never applied to. */
  plan: AccountPlan | null
  trial_ends_at: Date | null
  paid_until: Date | null
  plan_note: string | null
  /** Private: only the user and the server's admins see it. */
  email: string | null
  /** When `email` was confirmed by its emailed link; null while unverified. */
  email_verified_at: Date | null
}

export interface UserPlanFields {
  plan?: AccountPlan | null
  trial_ends_at?: Date | null
  paid_until?: Date | null
  plan_note?: string | null
}

export const CREATE_USER_ACCOUNTS_TABLE = `
  CREATE TABLE IF NOT EXISTS user_accounts (
    username     VARCHAR(255) PRIMARY KEY,
    created_at   TIMESTAMPTZ,
    pre_existing BOOLEAN NOT NULL DEFAULT FALSE,
    inserted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

export const ALTER_USER_ACCOUNTS_PLAN_COLUMNS = [
  'ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS plan VARCHAR(20)',
  'ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ',
  'ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS paid_until TIMESTAMPTZ',
  'ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS plan_note TEXT',
]

export const ALTER_USER_ACCOUNTS_PROFILE_COLUMNS = [
  'ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS email TEXT',
  'ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ',
]

/** False for an account created through a sign-in provider, whose password nobody knows. */
export const ALTER_USER_ACCOUNTS_LOGIN_COLUMNS = [
  'ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS password_login BOOLEAN NOT NULL DEFAULT TRUE',
]

const COLUMNS =
  'username, created_at, pre_existing, inserted_at, plan, trial_ends_at, paid_until, plan_note, email, email_verified_at'

const PLAN_COLUMNS = ['plan', 'trial_ends_at', 'paid_until', 'plan_note'] as const

const toDate = (value: unknown): Date | null => (value ? new Date(value as string) : null)

const mapRow = (row: Record<string, unknown>): UserAccount => ({
  created_at: toDate(row.created_at),
  email: (row.email as string | null) ?? null,
  email_verified_at: toDate(row.email_verified_at),
  inserted_at: new Date(row.inserted_at as string),
  paid_until: toDate(row.paid_until),
  plan: (row.plan as AccountPlan | null) ?? null,
  plan_note: (row.plan_note as string | null) ?? null,
  pre_existing: row.pre_existing as boolean,
  trial_ends_at: toDate(row.trial_ends_at),
  username: row.username as string,
})

export interface UserAccountsApi {
  /** Inserts the row unless one exists. Resolves to whether it inserted. */
  ensureUserAccount: (
    username: string,
    options: {
      createdAt: Date | null
      preExisting: boolean
      plan?: AccountPlan | null
      trialEndsAt?: Date | null
    },
  ) => Promise<boolean>
  /**
   * Inserts a pre-existing row, without a signup date, for each name that has none, on the given
   * starting plan (none by default). Resolves to the count inserted.
   */
  backfillUserAccounts: (
    usernames: string[],
    start?: { plan: AccountPlan | null; trialEndsAt: Date | null },
  ) => Promise<number>
  getUserAccount: (username: string) => Promise<UserAccount | null>
  listUserAccounts: () => Promise<UserAccount[]>
  deleteUserAccount: (username: string) => Promise<boolean>
  /** Marks every account without a plan exempt. Resolves to the count marked. */
  markUnplannedAccountsExempt: () => Promise<number>
  /**
   * Writes the given plan fields (an absent field is left as it is, null clears it), inserting a
   * pre-existing row when the account has none. Resolves to the row as stored.
   */
  updateUserPlan: (username: string, fields: UserPlanFields) => Promise<UserAccount>
  /**
   * Sets the account's email (null clears it); a different address clears its verification, the
   * same one keeps it. Resolves to the row as stored, or null when the
   * account has no row: inserting one here would make it a plan-less pre-existing account and keep
   * the startup backfill from starting its trial.
   */
  setUserEmail: (username: string, email: string | null) => Promise<UserAccount | null>
  /**
   * Marks the account's email verified, only while it still is `email`. Resolves to whether it
   * did.
   */
  markEmailVerified: (username: string, email: string) => Promise<boolean>
  /** The accounts whose verified email is `email`, compared without case, at most `limit`. */
  listAccountsByVerifiedEmail: (email: string, limit: number) => Promise<UserAccount[]>
  /** Whether the account's password is one its user knows; true for an account without a row. */
  getPasswordLogin: (username: string) => Promise<boolean>
  /** Resolves to whether the account has a row to set it on. */
  setPasswordLogin: (username: string, enabled: boolean) => Promise<boolean>
}

export const createUserAccountsApi = (getClient: () => Promise<Queryable>): UserAccountsApi => ({
  backfillUserAccounts: async (usernames, { plan, trialEndsAt } = { plan: null, trialEndsAt: null }) => {
    if (usernames.length === 0) return 0
    const client = await getClient()
    const result = await client.query(
      `INSERT INTO user_accounts (username, created_at, pre_existing, plan, trial_ends_at)
       SELECT name, NULL, TRUE, $2, $3 FROM unnest($1::text[]) AS name
       ON CONFLICT (username) DO NOTHING`,
      [usernames, plan, trialEndsAt],
    )
    return result.rowCount ?? 0
  },

  deleteUserAccount: async (username) => {
    const client = await getClient()
    const result = await client.query('DELETE FROM user_accounts WHERE username = $1', [username])
    return (result.rowCount ?? 0) > 0
  },

  ensureUserAccount: async (username, { createdAt, preExisting, plan = null, trialEndsAt = null }) => {
    const client = await getClient()
    const result = await client.query(
      `INSERT INTO user_accounts (username, created_at, pre_existing, plan, trial_ends_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO NOTHING`,
      [username, createdAt, preExisting, plan, trialEndsAt],
    )
    return (result.rowCount ?? 0) > 0
  },

  getPasswordLogin: async (username) => {
    const client = await getClient()
    const result = await client.query<{ password_login: boolean }>(
      'SELECT password_login FROM user_accounts WHERE username = $1',
      [username],
    )
    return result.rows[0]?.password_login ?? true
  },

  getUserAccount: async (username) => {
    const client = await getClient()
    const result = await client.query(`SELECT ${COLUMNS} FROM user_accounts WHERE username = $1`, [username])
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  listAccountsByVerifiedEmail: async (email, limit) => {
    const client = await getClient()
    const result = await client.query(
      `SELECT ${COLUMNS} FROM user_accounts
       WHERE lower(email) = lower($1) AND email_verified_at IS NOT NULL
       ORDER BY username LIMIT $2`,
      [email, limit],
    )
    return result.rows.map(mapRow)
  },

  listUserAccounts: async () => {
    const client = await getClient()
    const result = await client.query(`SELECT ${COLUMNS} FROM user_accounts ORDER BY username`)
    return result.rows.map(mapRow)
  },

  markUnplannedAccountsExempt: async () => {
    const client = await getClient()
    const result = await client.query(`UPDATE user_accounts SET plan = 'exempt' WHERE plan IS NULL`)
    return result.rowCount ?? 0
  },

  markEmailVerified: async (username, email) => {
    const client = await getClient()
    const result = await client.query(
      'UPDATE user_accounts SET email_verified_at = NOW() WHERE username = $1 AND email = $2',
      [username, email],
    )
    return (result.rowCount ?? 0) > 0
  },

  setPasswordLogin: async (username, enabled) => {
    const client = await getClient()
    const result = await client.query('UPDATE user_accounts SET password_login = $2 WHERE username = $1', [
      username,
      enabled,
    ])
    return (result.rowCount ?? 0) > 0
  },

  setUserEmail: async (username, email) => {
    const client = await getClient()
    const result = await client.query(
      `UPDATE user_accounts
       SET email = $2,
           email_verified_at = CASE WHEN email IS NOT DISTINCT FROM $2 THEN email_verified_at END
       WHERE username = $1 RETURNING ${COLUMNS}`,
      [username, email],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  updateUserPlan: async (username, fields) => {
    const columns = PLAN_COLUMNS.filter((column) => fields[column] !== undefined)
    const insertColumns = ['username', 'pre_existing', ...columns].join(', ')
    const placeholders = ['$1', 'TRUE', ...columns.map((_, i) => `$${i + 2}`)].join(', ')
    const assignments = (columns.length > 0 ? columns : ['username']).map(
      (column) => `${column} = EXCLUDED.${column}`,
    )
    const client = await getClient()
    const result = await client.query(
      `INSERT INTO user_accounts (${insertColumns}) VALUES (${placeholders})
       ON CONFLICT (username) DO UPDATE SET ${assignments.join(', ')}
       RETURNING ${COLUMNS}`,
      [username, ...columns.map((column) => fields[column])],
    )
    return mapRow(result.rows[0])
  },
})
