import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

export interface Auth {
  createToken: (username: string) => string
  getUsernameFromToken: (token: string) => string
}

export function createAuth(sessionSalt: string): Auth {
  if (!sessionSalt || Buffer.from(sessionSalt).length !== 32) {
    throw new Error('SESSION_SECRET must be set and be exactly 32 bytes (256 bits)')
  }

  return {
    createToken(username: string): string {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', sessionSalt, iv)
      return (
        cipher.update(username, 'utf8', 'base64') +
        cipher.final('base64') +
        `-${iv.toString('base64')}-${cipher.getAuthTag().toString('base64')}`
      )
    },

    getUsernameFromToken(token: string): string {
      if (!token) throw new Error('unauthenticated')

      const parts = token.split('-')
      if (parts.length !== 3) throw new Error('unauthenticated')

      const [encrypted, iv, tag] = parts

      try {
        const decipher = createDecipheriv('aes-256-gcm', sessionSalt, Buffer.from(iv, 'base64'))
        decipher.setAuthTag(Buffer.from(tag, 'base64'))
        return decipher.update(encrypted, 'base64', 'utf8') + decipher.final('utf8')
      } catch {
        throw new Error('unauthenticated')
      }
    },
  }
}
