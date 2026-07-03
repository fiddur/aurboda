import { describe, expect, it } from 'vitest'

import { DEFAULT_SUMMARY, defaultsFromChart, seriesLabel, summaryLabel } from './feed-metrics'

describe('defaultsFromChart', () => {
  it('falls back to DEFAULT_SUMMARY and no series when chart metrics are unknown', () => {
    expect(defaultsFromChart()).toEqual({ series: [], summary: DEFAULT_SUMMARY })
    expect(defaultsFromChart([])).toEqual({ series: [], summary: DEFAULT_SUMMARY })
  })

  it('maps charted metrics to their summaries (HR → avg + max + zones) and full series', () => {
    const { summary, series } = defaultsFromChart(['heart_rate', 'distance'])
    expect(summary).toEqual(['duration', 'distance', 'heart_rate_avg', 'heart_rate_max', 'hr_zone_minutes'])
    expect(series).toEqual(['heart_rate'])
  })

  it('includes series for a charted metric with no scalar summary (e.g. speed)', () => {
    const { summary, series } = defaultsFromChart(['speed'])
    // speed has no summary source; duration is always included.
    expect(summary).toEqual(['duration'])
    expect(series).toEqual(['speed'])
  })

  it('ignores charted metrics the dialog cannot represent', () => {
    const { summary, series } = defaultsFromChart(['hrv_rmssd'])
    expect(summary).toEqual(['duration'])
    expect(series).toEqual([])
  })
})

describe('metric labels', () => {
  it('resolves known labels and falls back to the raw key', () => {
    expect(summaryLabel('heart_rate_avg')).toBe('Avg HR')
    expect(seriesLabel('heart_rate')).toBe('Heart rate')
    expect(summaryLabel('unknown_key')).toBe('unknown_key')
  })
})
