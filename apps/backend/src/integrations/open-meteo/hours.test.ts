import { describe, expect, test } from 'vitest'

import { hourCells, hourStarts, planWeatherRequests, weatherCell } from './hours.ts'

const at = (iso: string): Date => new Date(iso)

describe('weatherCell', () => {
  test('rounds to a tenth of a degree', () => {
    expect(weatherCell(59.3293, 18.0686)).toEqual({ lat: 59.3, lon: 18.1 })
    expect(weatherCell(-33.8688, 151.2093)).toEqual({ lat: -33.9, lon: 151.2 })
  })

  test('never yields negative zero', () => {
    expect(Object.is(weatherCell(-0.04, -0.01).lat, -0)).toBe(false)
    expect(weatherCell(-0.04, -0.01)).toEqual({ lat: 0, lon: 0 })
  })
})

describe('hourStarts', () => {
  test('runs from the hour holding start to the last hour begun by end', () => {
    expect(hourStarts(at('2026-11-01T10:20:00Z'), at('2026-11-01T12:00:00Z'))).toEqual([
      at('2026-11-01T10:00:00Z'),
      at('2026-11-01T11:00:00Z'),
      at('2026-11-01T12:00:00Z'),
    ])
  })
})

describe('hourCells', () => {
  const home = { lat: 59.33, lon: 18.07 }
  const away = { lat: 57.7, lon: 11.97 }

  test('takes the last fix at or before the middle of the hour', () => {
    const fixes = [
      { ...home, time: at('2026-11-01T09:00:00Z') },
      { ...away, time: at('2026-11-01T10:30:00Z') },
      { ...home, time: at('2026-11-01T11:45:00Z') },
    ]
    expect(
      hourCells(fixes, [at('2026-11-01T09:00:00Z'), at('2026-11-01T10:00:00Z'), at('2026-11-01T11:00:00Z')]),
    ).toEqual([
      { lat: 59.3, lon: 18.1 },
      { lat: 57.7, lon: 12 },
      { lat: 57.7, lon: 12 },
    ])
  })

  test('an hour before any fix has none', () => {
    expect(hourCells([{ ...home, time: at('2026-11-01T10:00:00Z') }], [at('2026-11-01T09:00:00Z')])).toEqual([
      null,
    ])
  })

  test('carries a fix forward at most 7 days', () => {
    const fixes = [{ ...home, time: at('2026-11-01T00:00:00Z') }]
    expect(hourCells(fixes, [at('2026-11-07T23:00:00Z'), at('2026-11-08T00:00:00Z')])).toEqual([
      { lat: 59.3, lon: 18.1 },
      null,
    ])
  })
})

describe('planWeatherRequests', () => {
  const now = at('2026-11-28T12:30:00Z')
  const stockholm = { lat: 59.3, lon: 18.1 }
  const gothenburg = { lat: 57.7, lon: 12 }
  const hours = (from: string, count: number) =>
    hourStarts(at(from), new Date(at(from).getTime() + (count - 1) * 3_600_000))

  test('one forecast request per cell and contiguous date range', () => {
    const plan = planWeatherRequests(
      [
        ...hours('2026-11-20T22:00:00Z', 4).map((hour) => ({ cell: stockholm, hour })),
        ...hours('2026-11-24T10:00:00Z', 2).map((hour) => ({ cell: stockholm, hour })),
        ...hours('2026-11-22T08:00:00Z', 3).map((hour) => ({ cell: gothenburg, hour })),
      ],
      now,
    )
    expect(plan.cells).toBe(2)
    expect(plan.cells_deferred).toBe(0)
    expect(
      plan.requests.map(({ api, cell, end_date, hours: kept, start_date }) => ({
        api,
        cell,
        end_date,
        kept: kept.size,
        start_date,
      })),
    ).toEqual([
      { api: 'forecast', cell: stockholm, end_date: '2026-11-21', kept: 4, start_date: '2026-11-20' },
      { api: 'forecast', cell: stockholm, end_date: '2026-11-24', kept: 2, start_date: '2026-11-24' },
      { api: 'forecast', cell: gothenburg, end_date: '2026-11-22', kept: 3, start_date: '2026-11-22' },
    ])
  })

  test('splits a range at the 90-day line between the archive and the forecast API', () => {
    const plan = planWeatherRequests(
      hours('2026-08-29T00:00:00Z', 72).map((hour) => ({ cell: stockholm, hour })),
      now,
    )
    expect(plan.requests.map(({ api, end_date, start_date }) => ({ api, end_date, start_date }))).toEqual([
      { api: 'archive', end_date: '2026-08-29', start_date: '2026-08-29' },
      { api: 'forecast', end_date: '2026-08-31', start_date: '2026-08-30' },
    ])
  })

  test('drops hours after now', () => {
    const plan = planWeatherRequests(
      hours('2026-11-28T11:00:00Z', 4).map((hour) => ({ cell: stockholm, hour })),
      now,
    )
    expect([...plan.requests[0].hours].map((t) => new Date(t).toISOString())).toEqual([
      '2026-11-28T11:00:00.000Z',
      '2026-11-28T12:00:00.000Z',
    ])
  })

  test('caps the cells, the most used first, and counts the rest as deferred', () => {
    const assigned = Array.from({ length: 5 }, (_, i) =>
      hours('2026-11-27T00:00:00Z', i + 1).map((hour) => ({ cell: { lat: 50 + i, lon: 10 }, hour })),
    ).flat()
    const plan = planWeatherRequests(assigned, now, 2)
    expect(plan.cells).toBe(2)
    expect(plan.cells_deferred).toBe(3)
    expect(plan.requests.map((r) => r.cell.lat)).toEqual([54, 53])
  })

  test('cells with hours not stored yet come before cells only refreshed', () => {
    const plan = planWeatherRequests(
      [
        ...hours('2026-11-27T00:00:00Z', 10).map((hour) => ({ cell: stockholm, hour, refresh: true })),
        { cell: gothenburg, hour: at('2026-11-20T00:00:00Z') },
      ],
      now,
      1,
    )
    expect(plan.requests.map((r) => r.cell)).toEqual([gothenburg])
    expect(plan.cells_deferred).toBe(1)
    expect(plan.cells_deferred_missing).toBe(0)
  })

  test('counts the deferred cells that have hours not stored yet', () => {
    const plan = planWeatherRequests(
      [
        ...hours('2026-11-27T00:00:00Z', 10).map((hour) => ({ cell: stockholm, hour })),
        { cell: gothenburg, hour: at('2026-11-20T00:00:00Z') },
        { cell: { lat: 55.6, lon: 13 }, hour: at('2026-11-27T00:00:00Z'), refresh: true },
      ],
      now,
      1,
    )
    expect(plan.cells_deferred).toBe(2)
    expect(plan.cells_deferred_missing).toBe(1)
  })
})
