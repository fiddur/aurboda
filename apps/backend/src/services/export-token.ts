import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export interface ExportTokenPayload {
  type: 'export'
  user: string
  exp: number
  nonce: string
}

export interface ExportTokens {
  createExportToken: (user: string, ttlSeconds?: number, now?: Date) => { token: string; expires_at: Date }
  /** The token's payload when it is authentic, unexpired and not yet spent, else null. */
  verifyExportToken: (token: string, now?: Date) => ExportTokenPayload | null
  /**
   * Mark the token's nonce as spent. Called once a download completes rather than when it starts:
   * Android's WebView opens the URL, aborts it after the headers, and hands it to DownloadManager,
   * which requests it again.
   */
  spendExportToken: (payload: ExportTokenPayload) => void
}

const DEFAULT_TTL_SECONDS = 600

export const createExportTokens = (sessionSecret: string): ExportTokens => {
  if (!sessionSecret || Buffer.from(sessionSecret).length !== 32) {
    throw new Error('SESSION_SECRET must be set and be exactly 32 bytes (256 bits)')
  }

  const spent = new Map<string, number>()

  const encrypt = (payload: ExportTokenPayload): string => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', sessionSecret, iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
    return [encrypted, iv, cipher.getAuthTag()].map((part) => part.toString('base64url')).join('.')
  }

  const decrypt = (token: string): unknown => {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [encrypted, iv, tag] = parts.map((part) => Buffer.from(part, 'base64url'))
    try {
      const decipher = createDecipheriv('aes-256-gcm', sessionSecret, iv)
      decipher.setAuthTag(tag)
      return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'))
    } catch {
      return null
    }
  }

  const isPayload = (value: unknown): value is ExportTokenPayload => {
    if (typeof value !== 'object' || value === null) return false
    const p = value as Record<string, unknown>
    return (
      p.type === 'export' &&
      typeof p.user === 'string' &&
      typeof p.exp === 'number' &&
      typeof p.nonce === 'string'
    )
  }

  const seconds = (date: Date) => Math.floor(date.getTime() / 1000)

  return {
    createExportToken: (user, ttlSeconds = DEFAULT_TTL_SECONDS, now = new Date()) => {
      const exp = seconds(now) + ttlSeconds
      const token = encrypt({ exp, nonce: randomBytes(16).toString('base64url'), type: 'export', user })
      return { expires_at: new Date(exp * 1000), token }
    },
    spendExportToken: (payload) => {
      const nowSeconds = seconds(new Date())
      for (const [nonce, exp] of spent) if (exp <= nowSeconds) spent.delete(nonce)
      spent.set(payload.nonce, payload.exp)
    },
    verifyExportToken: (token, now = new Date()) => {
      if (!token) return null
      const payload = decrypt(token)
      if (!isPayload(payload) || payload.exp <= seconds(now) || spent.has(payload.nonce)) return null
      return payload
    },
  }
}
