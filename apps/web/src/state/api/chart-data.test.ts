import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchChartData, fetchChartFirstDay } from './chart-data'
import { browserTz } from './client'
import { fetchTrend } from './trends'

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

  it('sends the journal filters that are set, and no pattern', async () => {
    await fetchChartData({
      aggregation: 'sum',
      bucket_size: '1w',
      end: '2026-03-31T00:00:00Z',
      journal_q: '',
      journal_related_id: '00000000-0000-4000-8000-000000000001',
      journal_related_type: 'person',
      journal_tags: 'travel,work',
      source_type: 'journal',
      start: '2026-03-01T00:00:00Z',
    })

    const [, config] = vi.mocked(axios.get).mock.calls[0] ?? []
    expect(config?.params).toMatchObject({
      aggregation: 'sum',
      journal_related_id: '00000000-0000-4000-8000-000000000001',
      journal_related_type: 'person',
      journal_tags: 'travel,work',
      source_type: 'journal',
    })
    expect(config?.params).not.toHaveProperty('journal_q')
    expect(config?.params).not.toHaveProperty('pattern')
  })
})

describe('fetchTrend', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset()
    vi.mocked(axios.get).mockResolvedValue({
      data: { data: { current_value: 0, history: [] }, success: true },
    })
  })

  it('sends a journal trend without a pattern, with its filters', async () => {
    await fetchTrend({
      aggregation: 'count',
      journal_entity_types: 'time,day,activity,meal,report',
      journal_q: 'lake',
      lookback_days: 365,
      source_type: 'journal',
    })

    const [url, config] = vi.mocked(axios.get).mock.calls[0] ?? []
    expect(url).toBe('http://api.test/trends')
    expect(config?.params).toEqual({
      aggregation: 'count',
      journal_entity_types: 'time,day,activity,meal,report',
      journal_q: 'lake',
      lookback_days: '365',
      source_type: 'journal',
    })
  })

  it('still sends the pattern of another source', async () => {
    await fetchTrend({ pattern: 'coffee', source_type: 'activity_type' })

    const [, config] = vi.mocked(axios.get).mock.calls[0] ?? []
    expect(config?.params).toMatchObject({ pattern: 'coffee', source_type: 'activity_type' })
  })

  it('sends an all-time lookback (0) for the server to resolve', async () => {
    await fetchTrend({ lookback_days: 0, source_type: 'journal' })

    const [, config] = vi.mocked(axios.get).mock.calls[0] ?? []
    expect(config?.params).toMatchObject({ lookback_days: '0' })
  })
})

describe('fetchChartFirstDay', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset()
  })

  it("asks for the source's first day in the browser's zone", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { data: { first_day: '1995-04-02' }, success: true } })

    expect(
      await fetchChartFirstDay({ journal_q: '', journal_tags: 'travel', source_type: 'journal' }),
    ).toEqual({
      first_day: '1995-04-02',
    })
    const [url, config] = vi.mocked(axios.get).mock.calls[0] ?? []
    expect(url).toBe('http://api.test/chart-data/first-day')
    expect(config?.params).toEqual({ journal_tags: 'travel', source_type: 'journal', tz: browserTz })
  })

  it('answers no first day for a source without data', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { data: {}, success: true } })

    expect(await fetchChartFirstDay({ pattern: 'weight', source_type: 'metric' })).toEqual({})
  })
})
