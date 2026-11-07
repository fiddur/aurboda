import { describe, expect, test } from 'vitest'

import {
  absoluteApiUrl,
  detectInstallOs,
  installCommand,
  maskedInstallCommand,
  maskToken,
} from './activitywatch-install'

describe('detectInstallOs', () => {
  test.each([
    ['Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'windows'],
    ['', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15', 'mac'],
    ['Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'linux'],
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', 'linux'],
    ['', '', 'linux'],
  ] as const)('%s / %s → %s', (platform, userAgent, expected) => {
    expect(detectInstallOs(userAgent, platform)).toBe(expected)
  })
})

describe('absoluteApiUrl', () => {
  test('keeps an absolute URL, minus a trailing slash', () => {
    expect(absoluteApiUrl('https://aurboda.net/api/', 'https://other.example')).toBe(
      'https://aurboda.net/api',
    )
  })

  test('prefixes the page origin to a relative API base', () => {
    expect(absoluteApiUrl('/api', 'https://aurboda.net')).toBe('https://aurboda.net/api')
    expect(absoluteApiUrl('api', 'https://aurboda.net')).toBe('https://aurboda.net/api')
  })
})

describe('installCommand', () => {
  const api = 'https://aurboda.net/api'

  test('pipes the shell installer into bash on Linux and Mac', () => {
    const expected =
      "curl -fsSL https://aurboda.net/api/agents/activitywatch.sh | bash -s -- --token 'tok-en'"
    expect(installCommand('linux', api, 'tok-en')).toBe(expected)
    expect(installCommand('mac', api, 'tok-en')).toBe(expected)
  })

  test('sets the key and pipes the PowerShell installer into iex on Windows', () => {
    expect(installCommand('windows', api, 'tok-en')).toBe(
      "$env:AURBODA_TOKEN='tok-en'; irm https://aurboda.net/api/agents/activitywatch.ps1 | iex",
    )
  })

  test('masks the key in the shown command only', () => {
    const token = 'abcd+efgh/ijkl=-mnop-qrst'
    const shown = maskedInstallCommand('windows', api, token)
    expect(shown).not.toContain(token)
    expect(shown).toContain("$env:AURBODA_TOKEN='abcd…qrst'")
  })
})

describe('maskToken', () => {
  test('keeps a recognisable prefix and the last four characters', () => {
    expect(maskToken('aur_0123456789abcdef')).toBe('aur_…cdef')
  })

  test('shows the first and last four characters of another key', () => {
    expect(maskToken('Zm9vYmFy+abc=-aXY=-dGFn')).toBe('Zm9v…dGFn')
  })

  test('hides a short key completely', () => {
    expect(maskToken('abcdefgh')).toBe('…')
  })
})
