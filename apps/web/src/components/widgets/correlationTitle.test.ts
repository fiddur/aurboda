import { describe, expect, it } from 'vitest'

import { correlationTitle } from './correlationTitle'

describe('correlationTitle', () => {
  it('keeps a set title', () => {
    expect(
      correlationTitle({ activity: 'f1', activity_type: 'meal_sensitivity', title: 'Bread' }, 'Gluten'),
    ).toBe('Bread')
  })

  it('names the activity', () => {
    expect(correlationTitle({ activity: 'coffee', activity_type: 'activity_type' }, undefined)).toBe(
      'coffee impact',
    )
  })

  it('names the sensitivity flag, never its id', () => {
    expect(correlationTitle({ activity: 'f1', activity_type: 'meal_sensitivity' }, 'gluten')).toBe(
      'Meals with gluten impact',
    )
    expect(correlationTitle({ activity: 'f1', activity_type: 'meal_sensitivity' }, undefined)).toBe(
      'Meals with a sensitivity flag impact',
    )
  })
})
