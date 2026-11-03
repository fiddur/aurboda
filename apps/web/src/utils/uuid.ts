type UuidSource = Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string }

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * A v4 UUID. `crypto.randomUUID` exists only in secure contexts (HTTPS or localhost),
 * while `getRandomValues` exists everywhere, so a plain-HTTP origin builds one from that.
 */
export const uuidFrom = (source: UuidSource): string => {
  if (typeof source.randomUUID === 'function') return source.randomUUID()
  const bytes = source.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const h = hex(bytes)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const newId = (): string => uuidFrom(crypto)
