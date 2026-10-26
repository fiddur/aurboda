import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchChartData } from './chart-data'
import { browserTz } from './client'

vi.mock('axios')
vi.mock('../../config', () => ({ API_URL: 'http://api.test' }))
vi.mock('../auth', () => ({ auth: { value: { token: 't' } } }))

describe('fetchChartData', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset()
    vi.mocked(axios.get).mockResolvedValue({ data: { data: { buckets: [] }, success: true } })
  })

  it('sends the browser time zone so buckets align to local days', async () => {
    await fetchChartData({
      bucket_size: '1d',
      end: '2026-03-31T00:00:00Z',
      pattern: 'coffee',
      source_type: 'activity_type',
      start: '2026-03-01T00:00:00Z',
    })

    const [, config] = vi.mocked(axios.get).mock.calls[0]!
    expect(browserTz).toBeTruthy()
    expect(config?.params).toMatchObject({ bucket_size: '1d', pattern: 'coffee', tz: browserTz })
  })

  it('sends a measure with its item filter', async () => {
    await fetchChartData({
      aggregation: 'max',
      bucket_size: '1w',
      end: '2026-03-31T00:00:00Z',
      filter_field: 'sets.exercise',
      filter_value: 'Bench Press',
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
      start: '2026-03-01T00:00:00Z',
    })

    const [, config] = vi.mocked(axios.get).mock.calls[0] ?? []
    expect(config?.params).toMatchObject({
      aggregation: 'max',
      filter_field: 'sets.exercise',
      filter_value: 'Bench Press',
      measure: 'e1rm',
    })
  })

  it('leaves the measure params out when not set', async () => {
    await fetchChartData({
      end: '2026-03-31T00:00:00Z',
      filter_field: 'sets.exercise',
      pattern: 'strength_training',
      source_type: 'activity_type',
      start: '2026-03-01T00:00:00Z',
    })

    const [, config] = vi.mocked(axios.get).mock.calls[0] ?? []
    expect(config?.params).not.toHaveProperty('measure')
    expect(config?.params).not.toHaveProperty('filter_field')
    expect(config?.params).not.toHaveProperty('filter_value')
  })
})
