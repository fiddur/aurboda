import { describe, expect, it } from 'vitest'

import { withConfigValue } from './configValues'

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
