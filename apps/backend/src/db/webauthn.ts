/**
 * WebAuthn credential storage.
 *
 * One row per registered passkey for the user.
 */
import { query } from './connection.ts'

export interface WebAuthnCredentialRow {
  credential_id: string
  public_key: Buffer
  counter: bigint | number
  transports: string[]
  device_type: string | null
  backed_up: boolean
  nickname: string | null
  created_at: Date
  last_used_at: Date | null
}

const COLUMNS =
  'credential_id, public_key, counter, transports, device_type, backed_up, nickname, created_at, last_used_at'

export const insertWebAuthnCredential = async (
  user: string,
  cred: {
    credentialId: string
    publicKey: Buffer
    counter: number | bigint
    transports: string[]
    deviceType: string | null
    backedUp: boolean
    nickname?: string | null
  },
): Promise<void> => {
  await query(
    user,
    `INSERT INTO webauthn_credentials (credential_id, public_key, counter, transports, device_type, backed_up, nickname)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      cred.credentialId,
      cred.publicKey,
      cred.counter,
      cred.transports,
      cred.deviceType,
      cred.backedUp,
      cred.nickname ?? null,
    ],
  )
}

export const getWebAuthnCredentialById = async (
  user: string,
  credentialId: string,
): Promise<WebAuthnCredentialRow | null> => {
  const result = await query(user, `SELECT ${COLUMNS} FROM webauthn_credentials WHERE credential_id = $1`, [
    credentialId,
  ])
  return (result.rows[0] as WebAuthnCredentialRow | undefined) ?? null
}

export const getWebAuthnCredentialsForUser = async (user: string): Promise<WebAuthnCredentialRow[]> => {
  const result = await query(user, `SELECT ${COLUMNS} FROM webauthn_credentials ORDER BY created_at DESC`)
  return result.rows as WebAuthnCredentialRow[]
}

/**
 * Bump the counter and last_used_at for a credential. The `previousCounter`
 * argument provides cheap defense-in-depth against replay: only updates when
 * the new value is greater (or both are zero, which is what some
 * authenticators always report). Returns true on update.
 */
export const updateWebAuthnCredentialUsage = async (
  user: string,
  credentialId: string,
  previousCounter: number | bigint,
  newCounter: number | bigint,
): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE webauthn_credentials
       SET counter = $1, last_used_at = NOW()
     WHERE credential_id = $2 AND ($1 > $3 OR ($1 = 0 AND $3 = 0))`,
    [newCounter, credentialId, previousCounter],
  )
  return (result.rowCount ?? 0) > 0
}

export const updateWebAuthnCredentialNickname = async (
  user: string,
  credentialId: string,
  nickname: string,
): Promise<boolean> => {
  const result = await query(user, `UPDATE webauthn_credentials SET nickname = $1 WHERE credential_id = $2`, [
    nickname,
    credentialId,
  ])
  return (result.rowCount ?? 0) > 0
}

export const deleteWebAuthnCredential = async (user: string, credentialId: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM webauthn_credentials WHERE credential_id = $1`, [
    credentialId,
  ])
  return (result.rowCount ?? 0) > 0
}
