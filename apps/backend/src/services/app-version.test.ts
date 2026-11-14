import { describe, expect, test } from 'vitest'

import { appVersion } from './app-version.ts'

describe('appVersion', () => {
  test('a release image reports its release number', () => {
    expect(appVersion({ APP_VERSION: '1.0.3600', BUILD_SHA: 'abc123' })).toBe('1.0.3600')
  })

  test('a develop image, built with an empty APP_VERSION, reports its commit', () => {
    expect(appVersion({ APP_VERSION: '', BUILD_SHA: 'abc123' })).toBe('abc123')
  })

  test('a local run reports dev', () => {
    expect(appVersion({})).toBe('dev')
  })
})
