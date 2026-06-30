/**
 * Unit tests for the public-shares-router security helpers — the username
 * gate (which selects the per-user database) and the config sanitizer (which
 * neutralizes quick-link hrefs before exposing a config to anonymous viewers).
 */
import type { DashboardConfig } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { isValidPublicUsername, sanitizeConfig } from './public-shares-router.ts'

describe('isValidPublicUsername', () => {
  test('accepts valid usernames', () => {
    expect(isValidPublicUsername('fiddur')).toBe(true)
    expect(isValidPublicUsername('abc')).toBe(true)
    expect(isValidPublicUsername('a_b_2')).toBe(true)
  })

  test('rejects reserved usernames', () => {
    expect(isValidPublicUsername('public')).toBe(false)
    expect(isValidPublicUsername('admin')).toBe(false)
    expect(isValidPublicUsername('postgres')).toBe(false)
  })

  test('rejects malformed / injection-shaped input', () => {
    expect(isValidPublicUsername('AB')).toBe(false) // uppercase
    expect(isValidPublicUsername('1abc')).toBe(false) // leading digit
    expect(isValidPublicUsername('ab')).toBe(false) // too short
    expect(isValidPublicUsername('a'.repeat(40))).toBe(false) // too long
    expect(isValidPublicUsername('a-b')).toBe(false) // hyphen
    expect(isValidPublicUsername('a;drop')).toBe(false) // semicolon
    expect(isValidPublicUsername('a b')).toBe(false) // space
    expect(isValidPublicUsername('')).toBe(false)
  })
})

describe('sanitizeConfig', () => {
  test('neutralizes quick-link hrefs and leaves other widgets untouched', () => {
    const config: DashboardConfig = {
      sections: [
        {
          id: 's1',
          title: 'Links',
          type: 'links',
          widgets: [
            {
              config: { href: '/secret/admin', icon: 'goals', label: 'Goals' },
              id: 'ql',
              type: 'quick_link',
            },
            { config: { metric: 'hrv_7day', title: 'HRV' }, id: 'mc', type: 'metric_card' },
          ],
        },
      ],
      version: 1,
    }

    const sanitized = sanitizeConfig(config)
    const [quickLink, metricCard] = sanitized.sections[0].widgets

    expect(quickLink.type).toBe('quick_link')
    if (quickLink.type === 'quick_link') {
      expect(quickLink.config.href).toBe('#')
      expect(quickLink.config.label).toBe('Goals') // label preserved
    }
    expect(metricCard).toEqual(config.sections[0].widgets[1]) // untouched
    // Original config is not mutated.
    expect(config.sections[0].widgets[0]).toMatchObject({ config: { href: '/secret/admin' } })
  })
})
