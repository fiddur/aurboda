import { describe, expect, test, vi } from 'vitest'

import { allowHttpIssuer, createDiscoveryCache, issuerUrlProblem, type OidcClient } from './oidc-client.ts'

describe('issuerUrlProblem', () => {
  test('takes https, and http only when allowed', () => {
    expect(issuerUrlProblem('https://accounts.google.com', false)).toBeNull()
    expect(issuerUrlProblem('http://localhost:8080/realms/x', false)).toBe('The issuer must be an https URL')
    expect(issuerUrlProblem('http://localhost:8080/realms/x', true)).toBeNull()
    expect(issuerUrlProblem('ftp://example.com', true)).toBe('The issuer must be an https URL')
    expect(issuerUrlProblem('not a url', true)).toBe('The issuer is not a URL')
  })

  test('OIDC_ALLOW_HTTP_ISSUER=true allows http', () => {
    expect(allowHttpIssuer({ OIDC_ALLOW_HTTP_ISSUER: 'true' })).toBe(true)
    expect(allowHttpIssuer({})).toBe(false)
  })
})

describe('createDiscoveryCache', () => {
  const provider = (updatedAt: string) => ({
    client_id: 'c',
    client_secret: 's',
    id: 'google',
    issuer: 'https://accounts.google.com',
    updated_at: new Date(updatedAt),
  })

  test('reuses a discovery for an hour, and rediscovers after it or after a change', async () => {
    let clock = 0
    const discover = vi.fn(async () => ({ authorizationUrl: vi.fn(), exchange: vi.fn() }))
    const cached = createDiscoveryCache({ discover } as OidcClient, () => clock)
    await cached(provider('2026-11-16T10:00:00Z'))
    await cached(provider('2026-11-16T10:00:00Z'))
    expect(discover).toHaveBeenCalledTimes(1)
    clock = 60 * 60 * 1000
    await cached(provider('2026-11-16T10:00:00Z'))
    expect(discover).toHaveBeenCalledTimes(2)
    await cached(provider('2026-11-16T11:00:00Z'))
    expect(discover).toHaveBeenCalledTimes(3)
  })

  test('does not keep a failed discovery', async () => {
    const discover = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ authorizationUrl: vi.fn(), exchange: vi.fn() })
    const cached = createDiscoveryCache({ discover } as OidcClient, () => 0)
    await expect(cached(provider('2026-11-16T10:00:00Z'))).rejects.toThrow('down')
    await expect(cached(provider('2026-11-16T10:00:00Z'))).resolves.toBeDefined()
  })
})
