import type { WeatherSummary } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { weatherLine } from './weatherLine'

const summary = (overrides: Partial<WeatherSummary> = {}): WeatherSummary => ({
  code: 61,
  condition: 'Slight rain',
  emoji: '🌦️',
  hours: 2,
  precipitation_sum: 2.3,
  temperature_avg: 5,
  temperature_max: 6.2,
  temperature_min: 3.6,
  wind_speed_max: 4,
  ...overrides,
})

describe('weatherLine', () => {
  test('the condition, the temperature range and the precipitation', () => {
    expect(weatherLine(summary())).toBe('🌦️ Slight rain · 4–6 °C · 2.3 mm')
  })

  test('one temperature when the lowest and highest round alike, never -0', () => {
    expect(weatherLine(summary({ temperature_max: 4.4, temperature_min: 3.6 }))).toBe(
      '🌦️ Slight rain · 4 °C · 2.3 mm',
    )
    expect(weatherLine(summary({ precipitation_sum: 0, temperature_max: -0.2, temperature_min: -0.4 }))).toBe(
      '🌦️ Slight rain · 0 °C',
    )
  })

  test('leaves out what is missing: no precipitation, no temperature, no code', () => {
    expect(
      weatherLine(
        summary({
          code: 0,
          condition: 'Clear sky',
          emoji: '☀️',
          precipitation_sum: null,
          temperature_max: null,
          temperature_min: null,
        }),
      ),
    ).toBe('☀️ Clear sky')
    expect(weatherLine(summary({ code: null, precipitation_sum: 0 }))).toBe('4–6 °C')
  })
})
