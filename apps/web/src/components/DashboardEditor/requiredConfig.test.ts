import { describe, expect, it } from 'vitest'

import { blankRequiredFields } from './requiredConfig'

describe('blankRequiredFields', () => {
  it('flags a record card whose activity type was cleared', () => {
    expect(blankRequiredFields('record_card', { measure: 'e1rm', pattern: '' })).toEqual(['pattern'])
    expect(blankRequiredFields('record_card', { measure: 'e1rm', pattern: '   ' })).toEqual(['pattern'])
  })

  it('passes a record card with an activity type', () => {
    expect(blankRequiredFields('record_card', { measure: 'e1rm', pattern: 'strength_training' })).toEqual([])
  })

  it('lists every blank required field, missing or empty', () => {
    expect(blankRequiredFields('quick_link', { label: '' })).toEqual(['href', 'label'])
  })

  it('requires nothing of widgets without required text fields', () => {
    expect(blankRequiredFields('last_sleep', {})).toEqual([])
    expect(blankRequiredFields('bar_chart', {})).toEqual([])
  })
})
