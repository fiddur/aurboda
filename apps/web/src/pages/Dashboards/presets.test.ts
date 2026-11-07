import { describe, expect, test } from 'vitest'

import { nameAfterPresetChange, presetName } from './presets'

describe('presetName', () => {
  test('names each preset', () => {
    expect(presetName('blank')).toBe('New dashboard')
    expect(presetName('home')).toBe('Copy of home')
    expect(presetName('month_in_data')).toBe('Month in data')
  })
})

describe('nameAfterPresetChange', () => {
  test('follows the preset while the name is the previous preset’s or empty', () => {
    expect(nameAfterPresetChange('New dashboard', 'blank', 'month_in_data')).toBe('Month in data')
    expect(nameAfterPresetChange('', 'blank', 'home')).toBe('Copy of home')
    expect(nameAfterPresetChange('  ', 'home', 'blank')).toBe('New dashboard')
  })

  test('keeps a name the user typed', () => {
    expect(nameAfterPresetChange('Training log', 'blank', 'month_in_data')).toBe('Training log')
  })
})
