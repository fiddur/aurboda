/**
 * Unit tests for the SSRF guard. Uses literal IPs so no DNS lookup happens.
 */
import { describe, expect, test } from 'vitest'

import { assertPublicUrl, createPublicOnlyLookup, SafeFetchError } from './safe-fetch.ts'

describe('assertPublicUrl', () => {
  test('rejects loopback / private / link-local / reserved targets', async () => {
    const blocked = [
      'http://127.0.0.1/x',
      'http://10.1.2.3/x',
      'http://172.16.0.1/x',
      'http://192.168.1.1/x',
      'http://169.254.169.254/latest/meta-data', // cloud metadata
      'http://100.64.0.1/x', // CGNAT
      'http://0.0.0.0/x',
      'http://[::1]/x',
      'http://[fe80::1]/x',
      'http://[fd00::1]/x',
      'http://[::ffff:127.0.0.1]/x', // IPv4-mapped loopback
      'http://[::7f00:1]/x', // IPv4-compatible loopback (::127.0.0.1)
      'http://[64:ff9b::1]/x', // NAT64
    ]
    for (const url of blocked) {
      await expect(assertPublicUrl(url), url).rejects.toThrow()
    }
  })

  test('rejects non-http(s) protocols', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow()
    await expect(assertPublicUrl('ftp://example.com')).rejects.toThrow()
    await expect(assertPublicUrl('not a url')).rejects.toThrow()
  })

  test('allows public literal IPs', async () => {
    await expect(assertPublicUrl('https://8.8.8.8/x')).resolves.toBeUndefined()
    await expect(assertPublicUrl('http://1.1.1.1/x')).resolves.toBeUndefined()
  })

  test('refusals carry a code, so callers need not match on the message', async () => {
    const codeOf = async (url: string): Promise<string | undefined> => {
      try {
        await assertPublicUrl(url)
        return undefined
      } catch (error) {
        return error instanceof SafeFetchError ? error.code : `not-a-SafeFetchError: ${String(error)}`
      }
    }
    expect(await codeOf('not a url')).toBe('invalid_url')
    expect(await codeOf('ftp://example.com')).toBe('unsupported_scheme')
    expect(await codeOf('http://127.0.0.1/x')).toBe('private_address')
  })
})

describe('createPublicOnlyLookup', () => {
  type Resolved = string | { address: string; family: number }[]

  const resolve = (resolved: Resolved, failure: NodeJS.ErrnoException | null = null) =>
    new Promise<{ error: NodeJS.ErrnoException | null; address: Resolved }>((done) => {
      const lookup = createPublicOnlyLookup((_hostname, _options, callback) =>
        callback(failure, resolved, typeof resolved === 'string' ? 4 : undefined),
      )
      lookup('ha.example.org', {}, (error, address) => done({ address, error }))
    })

  test('passes a public address through', async () => {
    expect(await resolve('93.184.216.34')).toEqual({ address: '93.184.216.34', error: null })
  })

  test('refuses a private address', async () => {
    const { error } = await resolve('10.0.0.5')
    expect(error).toBeInstanceOf(SafeFetchError)
    expect(error?.code).toBe('private_address')
  })

  test('refuses the whole answer when any of several addresses is private', async () => {
    const { error } = await resolve([
      { address: '93.184.216.34', family: 4 },
      { address: '::1', family: 6 },
    ])
    expect(error?.code).toBe('private_address')
  })

  test('refuses an empty answer', async () => {
    expect((await resolve([])).error?.code).toBe('private_address')
  })

  test('passes a resolver failure through', async () => {
    const failure = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    expect((await resolve('', failure)).error).toBe(failure)
  })
})
