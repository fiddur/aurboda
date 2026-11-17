/**
 * Authorization-code + PKCE (S256) helpers shared by the OAuth integrations.
 * The PKCE verifier and the user are carried through the round-trip inside
 * the `state` parameter, sealed with AES-256-GCM under a key derived from the
 * client secret — so the callback can land on any backend instance without
 * shared session storage, and nobody can forge a state that links a grant to a
 * different user.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** Authorization codes are valid 10 minutes; a sealed state older than that is useless anyway. */
export const STATE_MAX_AGE_MS = 10 * 60 * 1000

export interface SealedState {
  iat: number
  user: string
  verifier: string
}

const base64url = (buf: Buffer): string => buf.toString('base64url')

export const createPkcePair = (): { verifier: string; challenge: string } => {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { challenge, verifier }
}

const stateKey = (clientSecret: string): Buffer => createHash('sha256').update(clientSecret).digest()

/** AES-256-GCM: iv(12) | tag(16) | ciphertext, base64url. Integrity comes from the tag. */
export const sealState = (state: SealedState, clientSecret: string): string => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', stateKey(clientSecret), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()])
  return base64url(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]))
}

const isSealedState = (value: unknown): value is SealedState =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SealedState).iat === 'number' &&
  typeof (value as SealedState).user === 'string' &&
  typeof (value as SealedState).verifier === 'string'

export const openState = (sealed: string, clientSecret: string, now: Date): SealedState | null => {
  try {
    const buf = Buffer.from(sealed, 'base64url')
    if (buf.length < 28) return null
    const decipher = createDecipheriv('aes-256-gcm', stateKey(clientSecret), buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
    const parsed: unknown = JSON.parse(plain)
    if (!isSealedState(parsed)) return null
    if (now.getTime() - parsed.iat > STATE_MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}
