import { describe, expect, test, vi } from 'vitest'
import { querySplitByCumulative, splitMetricsByCumulative } from './cumulative-query'

describe('splitMetricsByCumulative', () => {
  test('splits metrics into cumulative and non-cumulative', () => {
    const { cumulative, nonCumulative } = splitMetricsByCumulative([
      'heart_rate',
      'steps',
      'distance',
      'hrv_rmssd',
      'floors_climbed',
    ])

    expect(cumulative).toEqual(['steps', 'distance', 'floors_climbed'])
    expect(nonCumulative).toEqual(['heart_rate', 'hrv_rmssd'])
  })

  test('handles empty metrics', () => {
    const { cumulative, nonCumulative } = splitMetricsByCumulative([])
    expect(cumulative).toEqual([])
    expect(nonCumulative).toEqual([])
  })

  test('handles all cumulative', () => {
    const { cumulative, nonCumulative } = splitMetricsByCumulative(['steps', 'distance'])
    expect(cumulative).toEqual(['steps', 'distance'])
    expect(nonCumulative).toEqual([])
  })

  test('handles all non-cumulative', () => {
    const { cumulative, nonCumulative } = splitMetricsByCumulative(['heart_rate', 'hrv_rmssd'])
    expect(cumulative).toEqual([])
    expect(nonCumulative).toEqual(['heart_rate', 'hrv_rmssd'])
  })
})

describe('querySplitByCumulative', () => {
  test('runs queries for both cumulative and non-cumulative metrics', async () => {
    const queryFn = vi.fn()

    // Cumulative query result
    queryFn.mockResolvedValueOnce({
      rows: [{ metric: 'steps', value: 10000 }],
    })
    // Non-cumulative query result
    queryFn.mockResolvedValueOnce({
      rows: [{ metric: 'heart_rate', value: 72 }],
    })

    const results = await querySplitByCumulative({
      mapRow: (row) => ({ metric: row.metric as string, value: row.value as number }),
      metrics: ['steps', 'heart_rate'],
      params: [new Date('2024-01-15'), new Date('2024-01-16')],
      queryFn,
      sqlCumulative: `SELECT metric, value FROM time_series WHERE metric = ANY($1) AND time >= $2 AND time <= $3 AND source = 'health_connect_aggregate'`,
      sqlNonCumulative: `SELECT metric, value FROM time_series WHERE metric = ANY($1) AND time >= $2 AND time <= $3`,
    })

    expect(results).toEqual([
      { metric: 'steps', value: 10000 },
      { metric: 'heart_rate', value: 72 },
    ])

    expect(queryFn).toHaveBeenCalledTimes(2)
    // Cumulative query
    expect(queryFn).toHaveBeenCalledWith(
      `SELECT metric, value FROM time_series WHERE metric = ANY($1) AND time >= $2 AND time <= $3 AND source = 'health_connect_aggregate'`,
      [['steps'], new Date('2024-01-15'), new Date('2024-01-16')],
    )
    // Non-cumulative query
    expect(queryFn).toHaveBeenCalledWith(
      `SELECT metric, value FROM time_series WHERE metric = ANY($1) AND time >= $2 AND time <= $3`,
      [['heart_rate'], new Date('2024-01-15'), new Date('2024-01-16')],
    )
  })

  test('skips cumulative query when no cumulative metrics', async () => {
    const queryFn = vi.fn().mockResolvedValueOnce({
      rows: [{ metric: 'heart_rate', value: 72 }],
    })

    const results = await querySplitByCumulative({
      mapRow: (row) => ({ metric: row.metric as string, value: row.value as number }),
      metrics: ['heart_rate'],
      params: [new Date('2024-01-15'), new Date('2024-01-16')],
      queryFn,
      sqlCumulative: 'CUMULATIVE SQL',
      sqlNonCumulative: 'NON-CUMULATIVE SQL',
    })

    expect(results).toEqual([{ metric: 'heart_rate', value: 72 }])
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(queryFn).toHaveBeenCalledWith('NON-CUMULATIVE SQL', [
      ['heart_rate'],
      new Date('2024-01-15'),
      new Date('2024-01-16'),
    ])
  })

  test('skips non-cumulative query when no non-cumulative metrics', async () => {
    const queryFn = vi.fn().mockResolvedValueOnce({
      rows: [{ metric: 'steps', value: 5000 }],
    })

    const results = await querySplitByCumulative({
      mapRow: (row) => ({ metric: row.metric as string, value: row.value as number }),
      metrics: ['steps'],
      params: [new Date('2024-01-15'), new Date('2024-01-16')],
      queryFn,
      sqlCumulative: 'CUMULATIVE SQL',
      sqlNonCumulative: 'NON-CUMULATIVE SQL',
    })

    expect(results).toEqual([{ metric: 'steps', value: 5000 }])
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(queryFn).toHaveBeenCalledWith('CUMULATIVE SQL', [
      ['steps'],
      new Date('2024-01-15'),
      new Date('2024-01-16'),
    ])
  })

  test('returns empty when no metrics', async () => {
    const queryFn = vi.fn()

    const results = await querySplitByCumulative({
      mapRow: (row) => row,
      metrics: [],
      params: [],
      queryFn,
      sqlCumulative: 'SQL',
      sqlNonCumulative: 'SQL',
    })

    expect(results).toEqual([])
    expect(queryFn).not.toHaveBeenCalled()
  })
})
