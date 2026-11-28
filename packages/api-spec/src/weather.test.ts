import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isPrecipitatingWeatherCode, weatherCondition, wmoWeatherConditions } from './weather.ts'

const documentedCodes = [
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
]

describe('weatherCondition', () => {
  it('names every WMO code Open-Meteo documents', () => {
    assert.deepEqual(Object.keys(wmoWeatherConditions).map(Number), documentedCodes)
    for (const code of documentedCodes) assert.notEqual(weatherCondition(code).condition, 'Unknown')
  })

  it('answers Unknown for any other code', () => {
    assert.deepEqual(weatherCondition(42), { condition: 'Unknown', emoji: '🌡️' })
  })

  it('maps clear sky and thunderstorm', () => {
    assert.deepEqual(weatherCondition(0), { condition: 'Clear sky', emoji: '☀️' })
    assert.equal(weatherCondition(95).condition, 'Thunderstorm')
  })
})

describe('isPrecipitatingWeatherCode', () => {
  it('starts at drizzle (51)', () => {
    assert.equal(isPrecipitatingWeatherCode(48), false)
    assert.equal(isPrecipitatingWeatherCode(51), true)
    assert.equal(isPrecipitatingWeatherCode(99), true)
  })
})
