/**
 * Convert the stored actor keypair (PKCS#8 / SPKI PEM) into a WebCrypto
 * `CryptoKeyPair` that Fedify can use for HTTP Signatures.
 *
 * The PEMs are exported to JWK via Node's key objects and re-imported through
 * Fedify's `importJwk`, so the resulting keys carry exactly the algorithm
 * (`RSASSA-PKCS1-v1_5` / SHA-256) Fedify expects. We stamp `alg: 'RS256'` on the
 * JWK so the RSA key is unambiguously the signature variant (not RSA-OAEP/PSS).
 */
import { importJwk } from '@fedify/fedify'
import { createPrivateKey, createPublicKey } from 'node:crypto'

export const toCryptoKeyPair = async (
  privateKeyPem: string,
  publicKeyPem: string,
): Promise<CryptoKeyPair> => {
  const privateJwk = createPrivateKey(privateKeyPem).export({ format: 'jwk' })
  const publicJwk = createPublicKey(publicKeyPem).export({ format: 'jwk' })
  const [privateKey, publicKey] = await Promise.all([
    importJwk({ ...privateJwk, alg: 'RS256' }, 'private'),
    importJwk({ ...publicJwk, alg: 'RS256' }, 'public'),
  ])
  return { privateKey, publicKey }
}
