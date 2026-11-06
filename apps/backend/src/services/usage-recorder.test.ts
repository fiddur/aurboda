import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  createUsageRecorder,
  installUsageRecorder,
  recordIngestBySource,
  recordUsage,
  startUsageFlushing,
  type UsageRow,
} from './usage-recorder.ts'

const collecting = (now: () => Date) => {
  const flushed: UsageRow[][] = []
  const recorder = createUsageRecorder({
    flush: async (rows) => {
      flushed.push(rows)
    },
    now,
  })
  return { flushed, recorder }
}

afterEach(() => {
  installUsageRecorder(null)
  vi.useRealTimers()
})

describe('createUsageRecorder', () => {
  test('aggregates by user, UTC day, kind and channel', async () => {
    let at = new Date('2026-11-06T10:00:00Z')
    const { flushed, recorder } = collecting(() => at)

    recorder.record('alice', 'read', 'web')
    at = new Date('2026-11-06T11:00:00Z')
    recorder.record('alice', 'read', 'web')
    recorder.record('alice', 'write', 'web')
    recorder.record('bob', 'read', 'web')
    recorder.record('alice', 'ingest', 'garmin', 120)
    recorder.record('alice', 'ingest', 'garmin', 30)
    expect(recorder.size()).toBe(4)

    await recorder.flushNow()

    expect(flushed).toEqual([
      [
        {
          channel: 'web',
          count: 2,
          day: '2026-11-06',
          items: 2,
          kind: 'read',
          last_at: new Date('2026-11-06T11:00:00Z'),
          username: 'alice',
        },
        {
          channel: 'web',
          count: 1,
          day: '2026-11-06',
          items: 1,
          kind: 'write',
          last_at: at,
          username: 'alice',
        },
        { channel: 'web', count: 1, day: '2026-11-06', items: 1, kind: 'read', last_at: at, username: 'bob' },
        {
          channel: 'garmin',
          count: 2,
          day: '2026-11-06',
          items: 150,
          kind: 'ingest',
          last_at: at,
          username: 'alice',
        },
      ],
    ])
    expect(recorder.size()).toBe(0)
  })

  test('buckets by UTC date, not local date', async () => {
    let at = new Date('2026-11-06T23:59:59Z')
    const { flushed, recorder } = collecting(() => at)

    recorder.record('alice', 'read', 'api')
    at = new Date('2026-11-07T00:00:01Z')
    recorder.record('alice', 'read', 'api')
    await recorder.flushNow()

    expect(flushed[0].map((row) => [row.day, row.count])).toEqual([
      ['2026-11-06', 1],
      ['2026-11-07', 1],
    ])
  })

  test('does not call flush when nothing is pending', async () => {
    const flush = vi.fn(async () => {})
    await createUsageRecorder({ flush }).flushNow()
    expect(flush).not.toHaveBeenCalled()
  })

  test('a failed flush is logged, drops its rows and never throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const flush = vi.fn(async () => {
      throw new Error('central db down')
    })
    const recorder = createUsageRecorder({ flush })

    recorder.record('alice', 'read', 'web')
    await expect(recorder.flushNow()).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalledOnce()
    expect(recorder.size()).toBe(0)

    await recorder.flushNow()
    expect(flush).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  test('cuts a channel to the column width', async () => {
    const { flushed, recorder } = collecting(() => new Date('2026-11-06T10:00:00Z'))
    recorder.record('alice', 'ingest', 'x'.repeat(80))
    await recorder.flushNow()
    expect(flushed[0][0].channel).toBe('x'.repeat(50))
  })
})

describe('recordUsage', () => {
  test('is a no-op until a recorder is installed', async () => {
    const { flushed, recorder } = collecting(() => new Date('2026-11-06T10:00:00Z'))
    recordUsage('alice', 'read', 'web')
    installUsageRecorder(recorder)
    recordUsage('alice', 'read', 'web')
    await recorder.flushNow()
    expect(flushed[0].map((row) => row.count)).toEqual([1])
  })
})

describe('recordIngestBySource', () => {
  test('counts a mixed batch once per source, with that source’s rows as items', async () => {
    const { flushed, recorder } = collecting(() => new Date('2026-11-06T10:00:00Z'))
    installUsageRecorder(recorder)

    recordIngestBySource('alice', [{ s: 'oura' }, { s: 'garmin' }, { s: 'oura' }], (row) => row.s)
    recordIngestBySource('alice', [], (row: { s: string }) => row.s)
    await recorder.flushNow()

    expect(flushed[0].map(({ channel, count, items }) => ({ channel, count, items }))).toEqual([
      { channel: 'oura', count: 1, items: 2 },
      { channel: 'garmin', count: 1, items: 1 },
    ])
  })
})

describe('startUsageFlushing', () => {
  test('flushes on the interval until stopped', async () => {
    vi.useFakeTimers()
    const { flushed, recorder } = collecting(() => new Date('2026-11-06T10:00:00Z'))
    const stop = startUsageFlushing(recorder, 1000)

    recorder.record('alice', 'read', 'web')
    await vi.advanceTimersByTimeAsync(1000)
    expect(flushed).toHaveLength(1)

    stop()
    recorder.record('alice', 'read', 'web')
    await vi.advanceTimersByTimeAsync(5000)
    expect(flushed).toHaveLength(1)
  })
})
