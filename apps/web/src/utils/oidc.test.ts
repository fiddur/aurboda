import { describe, expect, test } from 'vitest'

import {
  codeFromHash,
  isLastLoginMethod,
  oidcErrorMessage,
  parseEmailDomains,
  rememberOidcVerifier,
  takeOidcVerifier,
  unlinkedProviders,
} from './oidc'

describe('oidcErrorMessage', () => {
  test('a message per code, the generic one for an unknown code, none without', () => {
    expect(oidcErrorMessage('not_linked')).toContain('Settings')
    expect(oidcErrorMessage('bogus')).toBe(oidcErrorMessage('failed'))
    expect(oidcErrorMessage(undefined)).toBeNull()
  })
})

describe('codeFromHash', () => {
  test('reads the code from the fragment', () => {
    expect(codeFromHash('#code=abc-123_x')).toBe('abc-123_x')
    expect(codeFromHash('#code=a%2Bb')).toBe('a+b')
    expect(codeFromHash('')).toBeNull()
    expect(codeFromHash('#other=1')).toBeNull()
  })
})

describe('unlinkedProviders and isLastLoginMethod', () => {
  test('offers only providers not linked yet', () => {
    const providers = [
      { allow_signup: false, display_name: 'Google', id: 'google', preset: 'google' as const },
      { allow_signup: false, display_name: 'Work', id: 'work', preset: null },
    ]
    const links = [
      {
        created_at: '2026-11-16T10:00:00Z',
        email: null,
        id: '1',
        last_login_at: null,
        provider_display_name: 'Google',
        provider_id: 'google',
      },
    ]
    expect(unlinkedProviders(providers, links).map((p) => p.id)).toEqual(['work'])
  })

  test('the last method cannot go', () => {
    expect(isLastLoginMethod(1)).toBe(true)
    expect(isLastLoginMethod(2)).toBe(false)
  })
})

describe('parseEmailDomains', () => {
  test('splits, lowercases, drops a leading @ and duplicates', () => {
    expect(parseEmailDomains('Example.com, @corp.example.com\nexample.com  ')).toEqual([
      'example.com',
      'corp.example.com',
    ])
    expect(parseEmailDomains('  ')).toEqual([])
  })
})

describe('rememberOidcVerifier and takeOidcVerifier', () => {
  const memoryStorage = () => {
    const items = new Map<string, string>()
    return {
      getItem: (key: string) => items.get(key) ?? null,
      items,
      removeItem: (key: string) => void items.delete(key),
      setItem: (key: string, value: string) => void items.set(key, value),
    }
  }

  test('the verifier is taken once', () => {
    const storage = memoryStorage()
    rememberOidcVerifier('v1', storage)
    rememberOidcVerifier('v2', storage)
    expect(takeOidcVerifier(storage)).toBe('v2')
    expect(takeOidcVerifier(storage)).toBeNull()
    expect(storage.items.size).toBe(0)
  })

  test('no storage, or storage that throws, means no verifier and no error', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => rememberOidcVerifier('v', throwing)).not.toThrow()
    expect(takeOidcVerifier(throwing)).toBeNull()
    rememberOidcVerifier('v', null)
    expect(takeOidcVerifier(null)).toBeNull()
  })
})
