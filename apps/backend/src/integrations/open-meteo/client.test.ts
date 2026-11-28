import { describe, expect, test, vi } from 'vitest'

import type { WeatherRequest } from './hours.ts'

import { fetchHourlyWeather, OPEN_METEO_ARCHIVE_URL, OPEN_METEO_FORECAST_URL } from './client.ts'

const request = (overrides: Partial<WeatherRequest> = {}): WeatherRequest => ({
  api: 'forecast',
  cell: { lat: 59.3, lon: 18.1 },
  end_date: '2026-11-02',
  hours: new Set(),
  start_date: '2026-11-01',
  ...overrides,
})

const answer = {
  hourly: {
    precipitation: [0, 0.4, null],
    temperature_2m: [3.2, 2.9, null],
    time: ['2026-11-01T00:00', '2026-11-01T01:00', '2026-11-01T02:00'],
    weather_code: [3, 61, null],
    wind_speed_10m: [4.1, null, null],
  },
}

const getReturning = (data: unknown) => vi.fn().mockResolvedValue({ data })

describe('fetchHourlyWeather', () => {
  test('asks the forecast API for the rounded cell only, in UTC and m/s', async () => {
    const get = getReturning(answer)
    await fetchHourlyWeather(request(), { get, userAgent: 'Aurboda/test' })

    const [url, config] = get.mock.calls[0]
    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe(OPEN_METEO_FORECAST_URL)
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      end_date: '2026-11-02',
      hourly: 'weather_code,temperature_2m,precipitation,wind_speed_10m',
      latitude: '59.3',
      longitude: '18.1',
      start_date: '2026-11-01',
      timezone: 'UTC',
      wind_speed_unit: 'ms',
    })
    expect(config.headers['User-Agent']).toBe('Aurboda/test')
    expect(config.timeout).toBeGreaterThan(0)
  })

  test('older days go to the archive API', async () => {
    const get = getReturning(answer)
    await fetchHourlyWeather(request({ api: 'archive' }), { get })
    expect(get.mock.calls[0][0].startsWith(`${OPEN_METEO_ARCHIVE_URL}?`)).toBe(true)
  })

  test('sends the shared Aurboda User-Agent by default', async () => {
    const get = getReturning(answer)
    await fetchHourlyWeather(request(), { get })
    expect(get.mock.calls[0][1].headers['User-Agent']).toMatch(/^Aurboda\//)
  })

  test('maps the hours as UTC, skipping nulls and hours without any value', async () => {
    const hours = await fetchHourlyWeather(request(), { get: getReturning(answer) })
    expect(hours).toEqual([
      {
        code: 3,
        precipitation: 0,
        temperature: 3.2,
        time: new Date('2026-11-01T00:00:00Z'),
        wind_speed: 4.1,
      },
      {
        code: 61,
        precipitation: 0.4,
        temperature: 2.9,
        time: new Date('2026-11-01T01:00:00Z'),
        wind_speed: undefined,
      },
    ])
  })

  test('rejects an answer of an unexpected shape', async () => {
    await expect(fetchHourlyWeather(request(), { get: getReturning({ error: true }) })).rejects.toThrow(
      /unexpected shape/,
    )
  })
})
