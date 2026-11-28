import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  isPrecipitatingWeatherCode,
  weatherCondition,
  weatherTemperatureText,
  wmoWeatherConditions,
} from './weather.ts'

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

describe('weatherTemperatureText', () => {
  it('gives the whole-degree range with a space before the unit', () => {
    assert.equal(weatherTemperatureText(3.6, 6.4), '4–6 °C')
    assert.equal(weatherTemperatureText(-3.5, 1), '-3–1 °C')
  })

  it('gives one value when the lowest and highest round alike', () => {
    assert.equal(weatherTemperatureText(4.6, 5.4), '5 °C')
  })

  it('never says -0', () => {
    assert.equal(weatherTemperatureText(-0.4, -0.2), '0 °C')
  })

  it('is undefined without both values', () => {
    assert.equal(weatherTemperatureText(null, 5), undefined)
    assert.equal(weatherTemperatureText(3, null), undefined)
  })
})
