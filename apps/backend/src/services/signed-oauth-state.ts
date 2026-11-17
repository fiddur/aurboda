import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SIGNED_STATE_MAX_AGE_MS = 10 * 60 * 1000
const MAX_CLOCK_SKEW_MS = 60_000

interface SignedStatePayload {
  iat: number
  nonce: string
  provider: string
  user: string
}

const hmacOf = (payloadB64: string, secret: string) =>
  createHmac('sha256', secret).update(payloadB64).digest('base64url')

const isPayload = (value: unknown): value is SignedStatePayload => {
  if (typeof value !== 'object' || value === null) return false
  const { iat, nonce, provider, user } = value as Record<string, unknown>
  return (
    typeof iat === 'number' &&
    Number.isFinite(iat) &&
    typeof nonce === 'string' &&
    typeof provider === 'string' &&
    typeof user === 'string'
  )
}

export const signOAuthState = (
  input: { provider: string; user: string },
  secret: string,
  now: Date,
): string => {
  const payload: SignedStatePayload = {
    iat: now.getTime(),
    nonce: randomBytes(16).toString('hex'),
    provider: input.provider,
    user: input.user,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${hmacOf(payloadB64, secret)}`
}

export const verifyOAuthState = (
  state: string,
  input: { provider: string },
  secret: string,
  now: Date,
): string | null => {
  try {
    const lastDot = state.lastIndexOf('.')
    if (lastDot === -1) return null

    const payloadB64 = state.slice(0, lastDot)
    const received = Buffer.from(state.slice(lastDot + 1))
    const expected = Buffer.from(hmacOf(payloadB64, secret))
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null

    const payload: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    if (!isPayload(payload)) return null
    if (payload.provider !== input.provider) return null

    const age = now.getTime() - payload.iat
    if (age > SIGNED_STATE_MAX_AGE_MS || -age > MAX_CLOCK_SKEW_MS) return null
    if (payload.user === '') return null

    return payload.user
  } catch {
    return null
  }
}
