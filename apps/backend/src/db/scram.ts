import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'

export const SCRAM_ITERATIONS = 4096
const SALT_BYTES = 16

/**
 * PostgreSQL's stored form of a SCRAM-SHA-256 password. Sent as the password of `CREATE USER` /
 * `ALTER USER`, it is stored as given, so the clear password never appears in a statement (and so
 * never in a statement log). SASLprep is reduced to NFKC for non-ASCII passwords, its common case.
 */
export const scramSha256Verifier = (
  password: string,
  salt: Buffer = randomBytes(SALT_BYTES),
  iterations: number = SCRAM_ITERATIONS,
): string => {
  const isAscii = [...password].every((char) => char.charCodeAt(0) < 0x80)
  const prepared = isAscii ? password : password.normalize('NFKC')
  const salted = pbkdf2Sync(Buffer.from(prepared, 'utf8'), salt, iterations, 32, 'sha256')
  const clientKey = createHmac('sha256', salted).update('Client Key').digest()
  const storedKey = createHash('sha256').update(clientKey).digest()
  const serverKey = createHmac('sha256', salted).update('Server Key').digest()
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`
}
