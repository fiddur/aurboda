import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, test } from 'vitest'

import { toCryptoKeyPair } from './keys.ts'

const rsaPem = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  })

describe('toCryptoKeyPair', () => {
  test('imports a stored PEM keypair into RSASSA-PKCS1-v1_5 WebCrypto keys that sign+verify', async () => {
    const { privateKey: privPem, publicKey: pubPem } = rsaPem()
    const { privateKey, publicKey } = await toCryptoKeyPair(privPem, pubPem)

    expect(privateKey.type).toBe('private')
    expect(publicKey.type).toBe('public')
    expect(privateKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5')
    expect(publicKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5')

    // Round-trip: a signature made with the private key verifies with the public
    // key — i.e. the keys are usable for HTTP Signatures.
    const data = new TextEncoder().encode('federation payload')
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data)
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sig, data)).toBe(true)

    const tampered = new TextEncoder().encode('federation payloaX')
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sig, tampered)).toBe(false)
  })

  test('the public key is extractable so the actor document can publish it', async () => {
    const { privateKey: privPem, publicKey: pubPem } = rsaPem()
    const { publicKey } = await toCryptoKeyPair(privPem, pubPem)
    expect(publicKey.extractable).toBe(true)
    // Exporting confirms it: Fedify serializes this into the actor's publicKey.
    const spki = await crypto.subtle.exportKey('spki', publicKey)
    expect(spki.byteLength).toBeGreaterThan(0)
  })
})
