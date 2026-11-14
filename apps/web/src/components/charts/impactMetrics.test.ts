import { describe, expect, test } from 'vitest'

import { impactAxisSides } from './impactMetrics'

describe('impactAxisSides', () => {
  test('all three: stress gets a second right axis', () => {
    expect(impactAxisSides(['hrv', 'hr', 'stress'])).toEqual({
      hr: 'right',
      hrv: 'left',
      stress: 'outer-right',
    })
  })

  test('stress takes the free side', () => {
    expect(impactAxisSides(['hr', 'stress'])).toEqual({ hr: 'right', stress: 'left' })
    expect(impactAxisSides(['hrv', 'stress'])).toEqual({ hrv: 'left', stress: 'right' })
    expect(impactAxisSides(['stress'])).toEqual({ stress: 'left' })
  })

  test('without stress, HRV left and heart rate right', () => {
    expect(impactAxisSides(['hrv', 'hr'])).toEqual({ hr: 'right', hrv: 'left' })
    expect(impactAxisSides([])).toEqual({})
  })
})
