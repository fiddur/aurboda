import { describe, expect, it, vi } from 'vitest'

import {
  type OAuthCompletionOptions,
  type OAuthProvider,
  oauthErrorText,
  oauthReturn,
  startOAuthCompletion,
  withoutOAuthReturn,
} from './oauthReturn'

const PROVIDERS: OAuthProvider[] = ['garmin', 'oura', 'strava', 'gravl']

describe('oauthReturn', () => {
  it.each(PROVIDERS)('reads the code and state the %s callback hands over', (provider) => {
    expect(oauthReturn(`?${provider}_code=fake-code&${provider}_state=fake%2Bstate`, provider)).toEqual({
      code: 'fake-code',
      state: 'fake+state',
    })
  })

  it.each(PROVIDERS)('is null for %s unless both are present and non-empty', (provider) => {
    expect(oauthReturn('', provider)).toBeNull()
    expect(oauthReturn(`?${provider}_code=fake-code`, provider)).toBeNull()
    expect(oauthReturn(`?${provider}_state=fake-state`, provider)).toBeNull()
    expect(oauthReturn(`?${provider}_code=&${provider}_state=fake-state`, provider)).toBeNull()
    expect(oauthReturn('?error=auth_failed', provider)).toBeNull()
  })

  it("does not read another provider's parameters", () => {
    expect(oauthReturn('?garmin_code=fake-code&garmin_state=fake-state', 'oura')).toBeNull()
  })
})

describe('withoutOAuthReturn', () => {
  it.each(PROVIDERS)('removes the %s code and state and keeps everything else', (provider) => {
    expect(
      withoutOAuthReturn(`?embed=1&${provider}_code=fake-code&${provider}_state=fake-state`, provider),
    ).toBe('?embed=1')
    expect(withoutOAuthReturn(`?${provider}_code=fake-code&${provider}_state=fake-state`, provider)).toBe('')
    expect(withoutOAuthReturn('', provider)).toBe('')
    expect(withoutOAuthReturn('?embed=1', provider)).toBe('?embed=1')
  })

  it("leaves another provider's parameters in place", () => {
    expect(withoutOAuthReturn('?garmin_code=fake-code&oura_code=fake-code', 'oura')).toBe(
      '?garmin_code=fake-code',
    )
  })
})

describe('oauthErrorText', () => {
  it('explains each callback error code, and an unknown one as a failed connection', () => {
    expect(oauthErrorText('auth_failed', 'Garmin')).toBe('Garmin did not complete the connection. Try again.')
    expect(oauthErrorText('not_configured', 'Oura')).toBe('This server has not set up Oura sign-in.')
    expect(oauthErrorText('invalid_state', 'Strava')).toBe('The connection attempt expired. Try again.')
    expect(oauthErrorText('something_else', 'Gravl')).toBe(
      'Gravl did not complete the connection. Try again.',
    )
    expect(oauthErrorText(null, 'Gravl')).toBeNull()
  })
})

describe('startOAuthCompletion', () => {
  const location = (search: string) => ({ hash: '#top', pathname: '/data-sources/oura', search })

  const options = (over: Partial<OAuthCompletionOptions> = {}): OAuthCompletionOptions => ({
    complete: vi.fn().mockResolvedValue({ success: true }),
    onChanged: vi.fn().mockResolvedValue(undefined),
    provider: 'oura',
    providerName: 'Oura',
    setError: vi.fn(),
    ...over,
  })

  it('does nothing when the address carries no handed-over sign-in', () => {
    const opts = options()
    const replaceUrl = vi.fn()
    expect(startOAuthCompletion(opts, location('?embed=1'), replaceUrl)).toBeNull()
    expect(replaceUrl).not.toHaveBeenCalled()
    expect(opts.complete).not.toHaveBeenCalled()
  })

  it('cleans the address before finishing, then refreshes the page', async () => {
    const order: string[] = []
    const replaceUrl = vi.fn((url: string) => order.push(`replace ${url}`))
    const opts = options({
      complete: vi.fn(async (code: string, state: string) => {
        order.push(`complete ${code} ${state}`)
        return { success: true }
      }),
      onChanged: vi.fn(async () => {
        order.push('changed')
      }),
    })

    const running = startOAuthCompletion(
      opts,
      location('?embed=1&oura_code=fake-code&oura_state=fake-state'),
      replaceUrl,
    )
    await running

    expect(order).toEqual([
      'replace /data-sources/oura?embed=1#top',
      'complete fake-code fake-state',
      'changed',
    ])
    expect(opts.setError).toHaveBeenCalledWith(null)
  })

  it('shows the error the server answers, and the fallback when it answers none', async () => {
    const refused = options({
      complete: vi
        .fn()
        .mockResolvedValue({ error: 'This Oura sign-in was started elsewhere.', success: false }),
    })
    await startOAuthCompletion(refused, location('?oura_code=c&oura_state=s'), vi.fn())
    expect(refused.setError).toHaveBeenLastCalledWith('This Oura sign-in was started elsewhere.')
    expect(refused.onChanged).not.toHaveBeenCalled()

    const silent = options({ complete: vi.fn().mockResolvedValue({ success: false }) })
    await startOAuthCompletion(silent, location('?oura_code=c&oura_state=s'), vi.fn())
    expect(silent.setError).toHaveBeenLastCalledWith('Oura did not complete the connection. Try again.')
  })

  it('shows the message of a request that fails, with the address already cleaned', async () => {
    const replaceUrl = vi.fn()
    const failing = options({ complete: vi.fn().mockRejectedValue(new Error('Network Error')) })
    await startOAuthCompletion(failing, location('?oura_code=c&oura_state=s'), replaceUrl)
    expect(replaceUrl).toHaveBeenCalledWith('/data-sources/oura#top')
    expect(failing.setError).toHaveBeenLastCalledWith('Network Error')
  })
})
