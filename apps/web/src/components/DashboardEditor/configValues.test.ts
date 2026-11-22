import { describe, expect, it } from 'vitest'

import { clampInt, editConfigValues, withConfigValue } from './configValues'

describe('withConfigValue', () => {
  it('sets a value', () => {
    expect(withConfigValue({ limit: 5 }, 'types', ['exercise'])).toEqual({ limit: 5, types: ['exercise'] })
    expect(withConfigValue({}, 'manual_only', true)).toEqual({ manual_only: true })
  })

  it('drops a key whose value is empty or false', () => {
    const config = { limit: 5, manual_only: true, title: 'Mine', types: ['exercise'], window: 'today' }
    expect(withConfigValue(config, 'manual_only', false)).not.toHaveProperty('manual_only')
    expect(withConfigValue(config, 'types', [])).not.toHaveProperty('types')
    expect(withConfigValue(config, 'title', undefined)).not.toHaveProperty('title')
    expect(withConfigValue(config, 'limit', Number.NaN)).not.toHaveProperty('limit')
  })
})

describe('editConfigValues', () => {
  it("starts from the card's config", () => {
    expect(
      editConfigValues({ limit: 5, window: 'today' }, { limit: 8, title: 'Mine', window: 'latest' }),
    ).toEqual({
      limit: 8,
      title: 'Mine',
      window: 'latest',
    })
  })

  it('fills a field the card was saved without from the defaults', () => {
    expect(editConfigValues({ limit: 3, source: 'media_artist' }, { source: 'place' })).toEqual({
      limit: 3,
      source: 'place',
    })
  })

  it('keeps visible_to_visitors as the card has it', () => {
    expect(editConfigValues({ window: 'today' }, { visible_to_visitors: true })).toEqual({
      visible_to_visitors: true,
      window: 'today',
    })
  })
})

describe('clampInt', () => {
  it('keeps a value inside the range', () => {
    expect(clampInt(7, 1, 20)).toBe(7)
  })

  it('pulls a value outside the range to the nearest end', () => {
    expect(clampInt(0, 1, 20)).toBe(1)
    expect(clampInt(-4, 1, 365)).toBe(1)
    expect(clampInt(50, 1, 20)).toBe(20)
    expect(clampInt(1000, 1, 365)).toBe(365)
  })

  it('drops a fraction', () => {
    expect(clampInt(4.7, 1, 20)).toBe(4)
  })

  it('leaves NaN, a cleared field, as NaN', () => {
    expect(clampInt(Number.NaN, 1, 20)).toBeNaN()
  })
})
