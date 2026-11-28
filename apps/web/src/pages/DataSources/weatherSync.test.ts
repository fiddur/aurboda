import { describe, expect, it } from 'vitest'

import { weatherSyncMessage } from './weatherSync'

describe('weatherSyncMessage', () => {
  it('counts the hours stored', () => {
    expect(weatherSyncMessage({ cells: 1, cells_deferred: 0, hours_stored: 1, status: 'success' })).toBe(
      '1 hour of weather stored',
    )
  })

  it('says when places are left to fetch', () => {
    expect(weatherSyncMessage({ cells: 20, cells_deferred: 3, hours_stored: 48, status: 'success' })).toBe(
      '48 hours of weather stored; 3 more places left, sync again to fetch them',
    )
  })

  it('says where a capped history fetch stopped', () => {
    expect(
      weatherSyncMessage({
        cells: 3,
        cells_deferred: 0,
        hours_stored: 8784,
        status: 'success',
        window_end: '2025-01-01T00:00:00.000Z',
      }),
    ).toBe('8784 hours of weather stored. Fetched up to 2025-01-01, fetch again from there to continue')
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
