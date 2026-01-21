import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

let sessionSalt: string | undefined

export function initializeAuth(): void {
  sessionSalt = process.env.SESSION_SALT
  if (!sessionSalt || Buffer.from(sessionSalt).length !== 32) {
    throw new Error('SESSION_SALT must be set and be exactly 32 bytes (256 bits)')
  }
}

export function getSessionSalt(): string {
  if (!sessionSalt) {
    throw new Error('Auth not initialized. Call initializeAuth() first.')
  }
  return sessionSalt
}

export function createToken(username: string): string {
  const salt = getSessionSalt()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', salt, iv)
  return (
    cipher.update(username, 'utf8', 'base64') +
    cipher.final('base64') +
    `-${iv.toString('base64')}-${cipher.getAuthTag().toString('base64')}`
  )
}

export function getUsernameFromToken(token: string): string {
  const salt = getSessionSalt()
  if (!token) throw new Error('unauthenticated')
  const [encrypted, iv, tag] = token.split('-')
  const decipher = createDecipheriv('aes-256-gcm', salt, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return decipher.update(encrypted, 'base64', 'utf8') + decipher.final('utf8')
}
