/**
 * Unit tests for the SSRF guard. Uses literal IPs so no DNS lookup happens.
 */
import { describe, expect, test } from 'vitest'

import { assertPublicUrl } from './safe-fetch.ts'

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
})
