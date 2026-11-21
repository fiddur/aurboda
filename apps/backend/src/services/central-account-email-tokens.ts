import type { Queryable } from '../db/pool.ts'

export type AccountEmailTokenPurpose = 'verify' | 'reset'

/** Only the SHA-256 of a token is stored: the token itself exists only in the mail. */
export const CREATE_ACCOUNT_EMAIL_TOKENS_TABLE = `
  CREATE TABLE IF NOT EXISTS account_email_tokens (
    token_hash  TEXT PRIMARY KEY,
    username    VARCHAR(255) NOT NULL,
    purpose     VARCHAR(10) NOT NULL,
    email       TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

export const CREATE_ACCOUNT_EMAIL_TOKENS_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_account_email_tokens_user ON account_email_tokens (username, purpose)',
]

export interface AccountEmailTokenIssue {
  token_hash: string
  username: string
  purpose: AccountEmailTokenPurpose
  email: string
  expires_at: Date
}

export interface ConsumedAccountEmailToken {
  username: string
  email: string
}

export interface AccountEmailTokensApi {
  /**
   * Stores a token, dropping the user's earlier unused tokens of the same purpose and every
   * expired row.
   */
  issueAccountEmailToken: (token: AccountEmailTokenIssue) => Promise<void>
  /**
   * Marks the token used, once, while it is unexpired and of the given purpose. Resolves to whom
   * and which address it was for, or null for an unknown, used, expired or other-purpose token.
   * `use` runs first, holding the token's row: it is marked used only when `use` succeeds, and a
   * second consumer waits for the first and then finds it used.
   */
  consumeAccountEmailToken: (
    tokenHash: string,
    purpose: AccountEmailTokenPurpose,
    use?: (consumed: ConsumedAccountEmailToken) => Promise<void>,
  ) => Promise<ConsumedAccountEmailToken | null>
}

export const createAccountEmailTokensApi = (
  getClient: () => Promise<Queryable>,
  withTransaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>,
): AccountEmailTokensApi => ({
  consumeAccountEmailToken: (tokenHash, purpose, use) =>
    withTransaction(async (tx) => {
      const result = await tx.query<ConsumedAccountEmailToken>(
        `SELECT username, email FROM account_email_tokens
         WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
         FOR UPDATE`,
        [tokenHash, purpose],
      )
      const consumed = result.rows[0]
      if (!consumed) return null
      await use?.(consumed)
      await tx.query('UPDATE account_email_tokens SET used_at = NOW() WHERE token_hash = $1', [tokenHash])
      return consumed
    }),

  issueAccountEmailToken: (token) =>
    withTransaction(async (tx) => {
      await tx.query('DELETE FROM account_email_tokens WHERE expires_at < NOW()')
      await tx.query(
        'DELETE FROM account_email_tokens WHERE username = $1 AND purpose = $2 AND used_at IS NULL',
        [token.username, token.purpose],
      )
      await tx.query(
        `INSERT INTO account_email_tokens (token_hash, username, purpose, email, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [token.token_hash, token.username, token.purpose, token.email, token.expires_at],
      )
    }),
})
