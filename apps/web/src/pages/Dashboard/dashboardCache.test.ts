import { type DashboardConfig, defaultDashboardConfig } from '@aurboda/api-spec'
import { describe, expect, it } from 'vitest'

import { readCachedDashboard, writeCachedDashboard } from './dashboardCache'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

const throwingStorage = () => {
  throw new Error('SecurityError')
}

describe('dashboard cache', () => {
  it('round-trips a valid config per user', () => {
    const storage = memoryStorage()
    writeCachedDashboard(() => storage, 'alice', defaultDashboardConfig)
    expect(readCachedDashboard(() => storage, 'alice')).toEqual(defaultDashboardConfig)
    expect(readCachedDashboard(() => storage, 'bob')).toBeUndefined()
  })

  it('returns undefined when nothing is cached', () => {
    expect(readCachedDashboard(() => memoryStorage(), 'alice')).toBeUndefined()
  })

  it('skips caching without a user', () => {
    const storage = memoryStorage()
    writeCachedDashboard(() => storage, undefined, defaultDashboardConfig)
    expect(storage.data.size).toBe(0)
    expect(readCachedDashboard(() => storage, undefined)).toBeUndefined()
  })

  it('ignores corrupt JSON', () => {
    const storage = memoryStorage({ 'aurboda:dashboard:alice': '{not json' })
    expect(readCachedDashboard(() => storage, 'alice')).toBeUndefined()
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['a wrong version', { ...defaultDashboardConfig, version: 2 }],
    ['missing sections', { version: 1 }],
    ['a section without widgets', { sections: [{ id: 's', title: 'S', type: 'metrics' }], version: 1 }],
    [
      'a widget without config',
      {
        sections: [{ id: 's', title: 'S', type: 'metrics', widgets: [{ id: 'w', type: 'metric_card' }] }],
        version: 1,
      },
    ],
  ])('ignores %s', (_label, value) => {
    const storage = memoryStorage({ 'aurboda:dashboard:alice': JSON.stringify(value) })
    expect(readCachedDashboard(() => storage, 'alice')).toBeUndefined()
  })

  it('survives storage that throws', () => {
    expect(readCachedDashboard(throwingStorage, 'alice')).toBeUndefined()
    expect(() => writeCachedDashboard(throwingStorage, 'alice', defaultDashboardConfig)).not.toThrow()
    const full = {
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    const config: DashboardConfig = { sections: [], version: 1 }
    expect(() => writeCachedDashboard(() => full, 'alice', config)).not.toThrow()
  })
})
