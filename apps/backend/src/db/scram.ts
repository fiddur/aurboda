import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'

export const SCRAM_ITERATIONS = 4096
const SALT_BYTES = 16

/**
 * SASLprep reduced to NFKC, its common case. The verifier is computed over this form, and `pg`
 * proves the string it is given without preparing it, so a login must offer this form too.
 */
export const preparedPassword = (password: string): string => password.normalize('NFKC')

/**
 * PostgreSQL's stored form of a SCRAM-SHA-256 password. Sent as the password of `CREATE USER` /
 * `ALTER USER`, it is stored as given, so the clear password never appears in a statement (and so
 * never in a statement log).
 */
export const scramSha256Verifier = (
  password: string,
  salt: Buffer = randomBytes(SALT_BYTES),
  iterations: number = SCRAM_ITERATIONS,
): string => {
  const salted = pbkdf2Sync(Buffer.from(preparedPassword(password), 'utf8'), salt, iterations, 32, 'sha256')
  const clientKey = createHmac('sha256', salted).update('Client Key').digest()
  const storedKey = createHash('sha256').update(clientKey).digest()
  const serverKey = createHmac('sha256', salted).update('Server Key').digest()
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`
}
