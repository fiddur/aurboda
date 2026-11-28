import type { WeatherHour } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import type { TimeSeriesEntry } from '../db/time-series.ts'
import type { WeatherCell } from '../integrations/open-meteo/hours.ts'

import {
  getWeather,
  locateHours,
  summariseDay,
  summariseWeather,
  summaryWeatherCode,
  type WeatherDeps,
  weatherHours,
} from './weather.ts'

const hour = (time: string, fields: Partial<Omit<WeatherHour, 'time'>> = {}): WeatherHour => ({
  code: null,
  precipitation: null,
  temperature: null,
  time,
  wind_speed: null,
  ...fields,
})

const entry = (time: string, metric: string, value: number, source = 'open_meteo'): TimeSeriesEntry => ({
  metric,
  source,
  time: new Date(time),
  unit: '',
  value,
})

describe('summaryWeatherCode', () => {
  test('the most frequent code when little of it precipitates', () => {
    expect(summaryWeatherCode([1, 1, 1, 2, 2, 61, 3, 3])).toBe(1)
  })

  test('the most frequent precipitating code once a quarter of the hours have one', () => {
    expect(summaryWeatherCode([1, 1, 1, 1, 1, 61, 61, 63])).toBe(61)
  })

  test('a tie goes to the higher code', () => {
    expect(summaryWeatherCode([1, 2])).toBe(2)
    expect(summaryWeatherCode([61, 63, 0, 0, 0, 0])).toBe(63)
  })

  test('no codes, no code', () => {
    expect(summaryWeatherCode([])).toBeNull()
  })
})

describe('summariseWeather', () => {
  test('null without hours', () => {
    expect(summariseWeather([])).toBeNull()
  })

  test('averages, extremes and sums over the hours that have a value', () => {
    expect(
      summariseWeather([
        hour('2026-11-01T10:00:00.000Z', { code: 3, precipitation: 0.2, temperature: 4, wind_speed: 3 }),
        hour('2026-11-01T11:00:00.000Z', { code: 3, precipitation: 0.1, temperature: 5, wind_speed: 6 }),
        hour('2026-11-01T12:00:00.000Z', { code: 2, temperature: 7 }),
      ]),
    ).toEqual({
      code: 3,
      condition: 'Overcast',
      emoji: '☁️',
      hours: 3,
      precipitation_sum: 0.3,
      temperature_avg: 5.3,
      temperature_max: 7,
      temperature_min: 4,
      wind_speed_max: 6,
    })
  })

  test('an hour without a code still counts, the condition is then unknown', () => {
    expect(summariseWeather([hour('2026-11-01T10:00:00.000Z', { temperature: 4 })])).toMatchObject({
      code: null,
      condition: 'Unknown',
      hours: 1,
    })
  })
})

describe('weatherHours', () => {
  const entries = [
    entry('2026-11-01T09:00:00Z', 'weather_code', 2),
    entry('2026-11-01T10:00:00Z', 'weather_code', 3),
    entry('2026-11-01T10:00:00Z', 'weather_temperature', 4.5),
    entry('2026-11-01T11:00:00Z', 'weather_code', 61),
    entry('2026-11-01T10:00:00Z', 'weather_temperature', 99, 'manual'),
  ]

  test('a short span gets the one hour that holds it', () => {
    expect(weatherHours(entries, new Date('2026-11-01T10:20:00Z'), new Date('2026-11-01T10:40:00Z'))).toEqual(
      [hour('2026-11-01T10:00:00.000Z', { code: 3, temperature: 4.5 })],
    )
  })

  test('a span covers every hour that overlaps it, not the one it ends at', () => {
    expect(
      weatherHours(entries, new Date('2026-11-01T09:30:00Z'), new Date('2026-11-01T11:00:00Z')).map(
        (h) => h.time,
      ),
    ).toEqual(['2026-11-01T09:00:00.000Z', '2026-11-01T10:00:00.000Z'])
  })

  test('an instant gets its hour', () => {
    const t = new Date('2026-11-01T11:00:00Z')
    expect(weatherHours(entries, t, t).map((h) => h.code)).toEqual([61])
  })
})

describe('summariseDay', () => {
  const stockholm: WeatherCell = { lat: 59.3, lon: 18.1 }
  const gothenburg: WeatherCell = { lat: 57.7, lon: 12 }
  const day = Array.from({ length: 24 }, (_, h) =>
    hour(`2026-11-01T${String(h).padStart(2, '0')}:00:00.000Z`, {
      code: h < 6 ? 0 : 61,
      temperature: h < 6 ? -2 : 8,
    }),
  )

  test('a travel day follows the place where most of its hours were spent', () => {
    const cells = day.map((_, h) => (h < 6 ? stockholm : gothenburg))
    expect(summariseDay(day, cells, 'UTC')).toMatchObject({
      code: 61,
      hours: 18,
      temperature_min: 8,
    })
  })

  test('the condition follows the daytime hours, the temperatures every hour', () => {
    const nightRain = day.map((h, i) => ({ ...h, code: i >= 7 && i <= 21 ? 1 : 65 }))
    expect(
      summariseDay(
        nightRain,
        day.map(() => stockholm),
        'UTC',
      ),
    ).toMatchObject({
      code: 1,
      hours: 24,
      temperature_min: -2,
    })
  })

  test('daytime is local time', () => {
    const codes = day.map((h, i) => ({ ...h, code: i >= 6 && i <= 20 ? 1 : 65 }))
    expect(
      summariseDay(
        codes,
        day.map(() => stockholm),
        'Europe/Stockholm',
      )?.code,
    ).toBe(1)
  })

  test('all hours count when no place can be told', () => {
    expect(
      summariseDay(
        day,
        day.map(() => null),
        'UTC',
      )?.hours,
    ).toBe(24)
  })
})

describe('locateHours', () => {
  const hours = Array.from(
    { length: 30 },
    (_, i) => new Date(Date.parse('2026-11-01T00:00:00Z') + i * 3_600_000),
  )

  const fixes = [
    { lat: 59.33, lon: 18.07, time: new Date('2026-10-31T20:00:00Z') },
    { lat: 57.7, lon: 11.97, time: new Date('2026-11-01T05:00:00Z') },
    { lat: 55.6, lon: 13.0, time: new Date('2026-11-02T00:10:00Z') },
    { lat: 60.39, lon: 5.32, time: new Date('2026-11-04T12:00:00Z') },
  ]
  const history = {
    getLastFixBefore: vi.fn(async (_user: string, before: Date, notBefore: Date) =>
      fixes.findLast((f) => f.time < before && f.time >= notBefore),
    ),
    getLocationPoints: vi.fn(async (_user: string, start: Date, end: Date) =>
      fixes.filter((f) => f.time >= start && f.time <= end),
    ),
  }

  test('a fix between two day chunks places the first hour after the boundary', async () => {
    const cells = await locateHours('alice', hours, history)

    expect(cells[23]).toEqual({ lat: 57.7, lon: 12 })
    expect(cells[24]).toEqual({ lat: 55.6, lon: 13 })
  })

  test('sparse hours: fixes in the hole between two chunks are not skipped', async () => {
    const sparse = [hours[0], new Date('2026-11-05T08:00:00Z')]
    const cells = await locateHours('alice', sparse, history)

    expect(cells).toEqual([
      { lat: 59.3, lon: 18.1 },
      { lat: 60.4, lon: 5.3 },
    ])
  })

  test('reads the fixes a day at a time and carries the last one across', async () => {
    const getLocationPoints = vi.fn(async (_user: string, start: Date) =>
      start.toISOString() === '2026-11-01T00:30:00.000Z'
        ? [{ lat: 57.7, lon: 11.97, time: new Date('2026-11-01T05:00:00Z') }]
        : [],
    )
    const getLastFixBefore = vi.fn(async (_user: string, before: Date) =>
      before.toISOString() === '2026-11-01T00:30:00.000Z'
        ? { lat: 59.33, lon: 18.07, time: new Date('2026-10-31T20:00:00Z') }
        : { lat: 57.7, lon: 11.97, time: new Date('2026-11-01T05:00:00Z') },
    )
    const cells = await locateHours('alice', hours, { getLastFixBefore, getLocationPoints })

    expect(getLocationPoints).toHaveBeenCalledTimes(2)
    expect(getLastFixBefore).toHaveBeenCalledWith(
      'alice',
      new Date('2026-11-01T00:30:00Z'),
      new Date('2026-10-25T00:30:00Z'),
    )
    expect(cells[0]).toEqual({ lat: 59.3, lon: 18.1 })
    expect(cells[5]).toEqual({ lat: 57.7, lon: 12 })
    expect(cells[29]).toEqual({ lat: 57.7, lon: 12 })
  })

  test('no hours, no reads', async () => {
    const getLastFixBefore = vi.fn()
    expect(await locateHours('alice', [], { getLastFixBefore, getLocationPoints: vi.fn() })).toEqual([])
    expect(getLastFixBefore).not.toHaveBeenCalled()
  })
})

describe('getWeather', () => {
  const deps = (overrides: Partial<WeatherDeps> = {}): WeatherDeps => ({
    getEntries: vi.fn(async () => [
      entry('2026-10-31T23:00:00Z', 'weather_code', 3),
      entry('2026-11-01T10:00:00Z', 'weather_code', 61),
    ]),
    getUserTimezone: vi.fn(async () => 'Europe/Stockholm'),
    locateHours: vi.fn(async (_user, hours) => hours.map(() => ({ lat: 59.3, lon: 18.1 }))),
    ...overrides,
  })

  test('a day in the user timezone by default', async () => {
    const d = deps()
    const result = await getWeather('alice', { date: '2026-11-01' }, d)
    expect(d.getEntries).toHaveBeenCalledWith(
      'alice',
      ['weather_code', 'weather_temperature', 'weather_precipitation', 'weather_wind_speed'],
      new Date('2026-10-31T23:00:00Z'),
      new Date('2026-11-01T22:59:59.999Z'),
    )
    expect(result).toMatchObject({
      ok: true,
      tz: 'Europe/Stockholm',
      weather: { hours: [{ code: 3 }, { code: 61 }], summary: { hours: 2 } },
    })
  })

  test('a span with no stored weather has no summary', async () => {
    const result = await getWeather(
      'alice',
      { end: '2026-11-01T10:40:00Z', start: '2026-11-01T10:20:00Z' },
      deps({ getEntries: vi.fn(async () => []) }),
    )
    expect(result).toEqual({ ok: true, tz: undefined, weather: { hours: [], summary: null } })
  })

  test('refuses neither or both forms', async () => {
    expect((await getWeather('alice', {}, deps())).ok).toBe(false)
    expect(
      (
        await getWeather(
          'alice',
          { date: '2026-11-01', end: '2026-11-01T10:40:00Z', start: '2026-11-01T10:20:00Z' },
          deps(),
        )
      ).ok,
    ).toBe(false)
  })
})
