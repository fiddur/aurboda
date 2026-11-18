import { createHash, createHmac } from 'node:crypto'
import { describe, expect, test } from 'vitest'

import { preparedPassword, scramSha256Verifier } from './scram.ts'

const parse = (verifier: string) => {
  const match = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier)
  if (!match) throw new Error(`not a verifier: ${verifier}`)
  return {
    iterations: Number(match[1]),
    salt: Buffer.from(match[2], 'base64'),
    serverKey: Buffer.from(match[4], 'base64'),
    storedKey: Buffer.from(match[3], 'base64'),
  }
}

describe('scramSha256Verifier', () => {
  // RFC 7677, section 3: user "user", password "pencil".
  const rfcSalt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64')
  const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0'
  const authMessage = [
    'n=user,r=rOprNGfwEbeRWgbNEkqO',
    `r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096`,
    `c=biws,r=${nonce}`,
  ].join(',')
  const clientProof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64')
  const serverSignature = '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4='

  test('matches the RFC 7677 exchange', () => {
    const verifier = scramSha256Verifier('pencil', rfcSalt, 4096)
    const { iterations, salt, serverKey, storedKey } = parse(verifier)
    expect(iterations).toBe(4096)
    expect(salt.equals(rfcSalt)).toBe(true)
    expect(createHmac('sha256', serverKey).update(authMessage).digest('base64')).toBe(serverSignature)

    const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest()
    const clientKey = Buffer.from(clientProof.map((byte, i) => byte ^ clientSignature[i]))
    expect(createHash('sha256').update(clientKey).digest().equals(storedKey)).toBe(true)
  })

  test('defaults to 4096 iterations and 16 random salt bytes', () => {
    const first = parse(scramSha256Verifier('secret'))
    const second = parse(scramSha256Verifier('secret'))
    expect(first.iterations).toBe(4096)
    expect(first.salt).toHaveLength(16)
    expect(first.salt.equals(second.salt)).toBe(false)
  })

  test('never contains the clear password', () => {
    expect(scramSha256Verifier('pencil')).not.toContain('pencil')
  })

  test('normalizes a non-ASCII password to NFKC', () => {
    const salt = Buffer.alloc(16, 1)
    expect(scramSha256Verifier('ﬁsh', salt, 2)).toBe(scramSha256Verifier('fish', salt, 2))
    expect(scramSha256Verifier('café', salt, 2)).toBe(scramSha256Verifier('café', salt, 2))
  })
})

describe('preparedPassword', () => {
  test('is the NFKC form, and leaves ASCII alone', () => {
    expect(preparedPassword('Ｐａｓｓword-ﬁx')).toBe('Password-fix')
    expect(preparedPassword('pencil')).toBe('pencil')
  })
})
