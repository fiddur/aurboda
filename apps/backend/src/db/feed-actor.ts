import { generateKeyPair } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * The user's ActivityPub actor keypair.
 *
 * Each per-user database hosts exactly one actor (the user themselves), so the
 * keypair lives in the singleton `feed_actor` table. The RSA keypair signs
 * outbound federation traffic (HTTP Signatures) and its public half is
 * published in the actor document; PEM encoding (PKCS#8 private / SPKI public)
 * is chosen so it converts cleanly to a WebCrypto `CryptoKey` for the federation
 * layer.
 */
import { query } from './connection.ts'

const generateKeyPairAsync = promisify(generateKeyPair)

export interface ActorKeyPair {
  private_key_pem: string
  public_key_pem: string
  created_at: Date
}

interface ActorKeyPairRow {
  private_key_pem: string
  public_key_pem: string
  created_at: Date
}

const generateRsaKeyPair = async (): Promise<{ privateKeyPem: string; publicKeyPem: string }> => {
  const { privateKey, publicKey } = await generateKeyPairAsync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  })
  return { privateKeyPem: privateKey, publicKeyPem: publicKey }
}

/**
 * Return the user's actor keypair, generating and persisting it on first use.
 *
 * Idempotent and race-safe: a concurrent first call may generate a second
 * keypair, but the `ON CONFLICT (singleton) DO NOTHING` insert keeps whichever
 * landed first, and the subsequent read returns that single stored pair.
 */
export const getOrCreateActorKeyPair = async (user: string): Promise<ActorKeyPair> => {
  const existing = await query<ActorKeyPairRow>(
    user,
    `SELECT private_key_pem, public_key_pem, created_at FROM feed_actor WHERE singleton = true`,
  )
  if (existing.rows.length > 0) return existing.rows[0]

  const { privateKeyPem, publicKeyPem } = await generateRsaKeyPair()
  await query(
    user,
    `INSERT INTO feed_actor (singleton, private_key_pem, public_key_pem)
     VALUES (true, $1, $2)
     ON CONFLICT (singleton) DO NOTHING`,
    [privateKeyPem, publicKeyPem],
  )
  const stored = await query<ActorKeyPairRow>(
    user,
    `SELECT private_key_pem, public_key_pem, created_at FROM feed_actor WHERE singleton = true`,
  )
  return stored.rows[0]
}
