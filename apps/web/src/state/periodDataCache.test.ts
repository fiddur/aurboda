import type { DashboardDataResponse } from '@aurboda/api-spec'

import { defaultDashboardConfig } from '@aurboda/api-spec'
import { describe, expect, it } from 'vitest'

import {
  clearPeriodData,
  configVersion,
  MAX_ENTRIES,
  MAX_ENTRY_CHARS,
  type PeriodDataSlot,
  periodDataKey,
  readPeriodData,
  writePeriodData,
} from './periodDataCache'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

const throwingStorage = () => {
  throw new Error('SecurityError')
}

const metricCard = {
  data: { count: 1, max: null, trend_percent: null, value: 42 },
  type: 'metric_card' as const,
}

const answer = (period: string): DashboardDataResponse => ({
  period,
  success: true,
  widget_data: { w1: metricCard },
  window: { end: '2026-11-01T00:00:00.000Z', start: '2026-10-01T00:00:00.000Z' },
})

const slot = (overrides: Partial<PeriodDataSlot> = {}): PeriodDataSlot => ({
  boardId: 'board-1',
  granularity: 'month',
  period: '2026-10',
  version: 'v1',
  viewer: 'alice',
  ...overrides,
})

const morning = new Date(2026, 10, 10, 8).getTime()
const evening = new Date(2026, 10, 10, 22).getTime()
const nextDay = new Date(2026, 10, 11, 8).getTime()

describe('period data cache', () => {
  it('round-trips an answer with the time it was saved', () => {
    const storage = memoryStorage()
    writePeriodData(() => storage, slot(), answer('2026-10'), morning)
    expect(readPeriodData(() => storage, slot(), nextDay)).toEqual({
      data: answer('2026-10'),
      savedAt: morning,
    })
  })

  it('keys by viewer, board, granularity and period', () => {
    expect(periodDataKey(slot())).toBe('aurboda:dashboardData:alice:board-1:month:2026-10')
    expect(periodDataKey(slot({ period: null }))).toBe('aurboda:dashboardData:alice:board-1:month:latest')
    const storage = memoryStorage()
    writePeriodData(() => storage, slot(), answer('2026-10'), morning)
    expect(readPeriodData(() => storage, slot({ viewer: 'bob' }), morning)).toBeUndefined()
    expect(readPeriodData(() => storage, slot({ period: '2026-09' }), morning)).toBeUndefined()
  })

  it('ignores an answer resolved from another config', () => {
    const storage = memoryStorage()
    writePeriodData(() => storage, slot(), answer('2026-10'), morning)
    expect(readPeriodData(() => storage, slot({ version: 'v2' }), morning)).toBeUndefined()
  })

  it('reuses a latest answer only on the day it was saved', () => {
    const storage = memoryStorage()
    const latest = slot({ period: null })
    writePeriodData(() => storage, latest, answer('2026-10'), morning)
    expect(readPeriodData(() => storage, latest, evening)?.data.period).toBe('2026-10')
    expect(readPeriodData(() => storage, latest, nextDay)).toBeUndefined()
  })

  it('does not store an answer without a period or widget data', () => {
    const storage = memoryStorage()
    writePeriodData(
      () => storage,
      slot(),
      { period: null, success: true, widget_data: {}, window: null },
      morning,
    )
    writePeriodData(() => storage, slot(), { period: '2026-10', success: true }, morning)
    expect(storage.data.size).toBe(0)
  })

  it('skips an oversized answer and drops the older one for the slot', () => {
    const storage = memoryStorage()
    writePeriodData(() => storage, slot(), answer('2026-10'), morning)
    const widgets = Math.ceil(MAX_ENTRY_CHARS / JSON.stringify(metricCard).length)
    const huge = {
      ...answer('2026-10'),
      widget_data: Object.fromEntries(Array.from({ length: widgets }, (_, i) => [`w${i}`, metricCard])),
    }
    writePeriodData(() => storage, slot(), huge, evening)
    expect(readPeriodData(() => storage, slot(), evening)).toBeUndefined()
    expect(storage.data.get('aurboda:dashboardData:index')).toBe('[]')
  })

  it('keeps the newest entries and evicts the oldest', () => {
    const storage = memoryStorage()
    const periods = Array.from(
      { length: MAX_ENTRIES + 2 },
      (_, i) => `2025-${String(i + 1).padStart(2, '0')}`,
    )
    for (const period of periods) writePeriodData(() => storage, slot({ period }), answer(period), morning)
    expect(readPeriodData(() => storage, slot({ period: periods[0] }), morning)).toBeUndefined()
    expect(readPeriodData(() => storage, slot({ period: periods[1] }), morning)).toBeUndefined()
    for (const period of periods.slice(2)) {
      expect(readPeriodData(() => storage, slot({ period }), morning)?.data.period).toBe(period)
    }
    expect(storage.data.size).toBe(MAX_ENTRIES + 1)
  })

  it('refreshes an entry rewritten for the same slot instead of evicting it first', () => {
    const storage = memoryStorage()
    const periods = Array.from({ length: MAX_ENTRIES }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`)
    for (const period of periods) writePeriodData(() => storage, slot({ period }), answer(period), morning)
    writePeriodData(() => storage, slot({ period: periods[0] }), answer(periods[0]), evening)
    writePeriodData(() => storage, slot({ period: '2026-01' }), answer('2026-01'), evening)
    expect(readPeriodData(() => storage, slot({ period: periods[0] }), evening)).toBeDefined()
    expect(readPeriodData(() => storage, slot({ period: periods[1] }), evening)).toBeUndefined()
  })

  it('treats malformed entries as missing', () => {
    const key = periodDataKey(slot())
    expect(readPeriodData(() => memoryStorage({ [key]: 'not json' }), slot(), morning)).toBeUndefined()
    expect(
      readPeriodData(() => memoryStorage({ [key]: '{"version":"v1"}' }), slot(), morning),
    ).toBeUndefined()
  })

  it('survives storage that throws', () => {
    expect(readPeriodData(throwingStorage, slot(), morning)).toBeUndefined()
    expect(() => writePeriodData(throwingStorage, slot(), answer('2026-10'), morning)).not.toThrow()
    expect(() => clearPeriodData(throwingStorage)).not.toThrow()
    const full = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(() => writePeriodData(() => full, slot(), answer('2026-10'), morning)).not.toThrow()
  })

  it('clears only its own entries', () => {
    const storage = memoryStorage({ 'aurboda:chunk-reload': '1' })
    writePeriodData(() => storage, slot(), answer('2026-10'), morning)
    clearPeriodData(() => storage)
    expect([...storage.data.keys()]).toEqual(['aurboda:chunk-reload'])
  })

  it('versions a config by its content', () => {
    const copy = structuredClone(defaultDashboardConfig)
    expect(configVersion(copy)).toBe(configVersion(defaultDashboardConfig))
    expect(configVersion({ ...copy, description: 'changed' })).not.toBe(configVersion(defaultDashboardConfig))
  })
})
