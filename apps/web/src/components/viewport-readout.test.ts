import { describe, expect, test } from 'vitest'

import { formatViewportReadout } from './viewport-readout'

describe('formatViewportReadout', () => {
  test('lists 100vh, innerHeight and the html height in whole px', () => {
    expect(formatViewportReadout({ html: 812, inner_height: 812, vh: 812 })).toBe(
      'Viewport: 100vh = 812 px · innerHeight = 812 px · html = 812 px',
    )
  })

  test('rounds fractional heights', () => {
    expect(formatViewportReadout({ html: 811.6, inner_height: 812, vh: 0.4 })).toBe(
      'Viewport: 100vh = 0 px · innerHeight = 812 px · html = 812 px',
    )
  })
})
