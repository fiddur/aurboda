import { describe, expect, it } from 'vitest'

import { weatherSyncMessage } from './weatherSync'

describe('weatherSyncMessage', () => {
  it('counts the hours stored', () => {
    expect(weatherSyncMessage({ cells: 1, cells_deferred: 0, hours_stored: 1, status: 'success' })).toBe(
      '1 hour of weather stored',
    )
  })

  it('says when places wait for the next sync', () => {
    expect(weatherSyncMessage({ cells: 20, cells_deferred: 3, hours_stored: 48, status: 'success' })).toBe(
      '48 hours of weather stored; 3 more places will follow in the next sync',
    )
  })

  it('shows the error of a failed or skipped sync', () => {
    expect(
      weatherSyncMessage({
        cells: 0,
        cells_deferred: 0,
        error: 'Weather is not enabled',
        hours_stored: 0,
        status: 'skipped',
      }),
    ).toBe('Weather is not enabled')
  })
})
