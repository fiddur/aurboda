import type { MetricType } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  buildShareBody,
  DEFAULT_SUMMARY,
  defaultsFromChart,
  initialSeriesSelection,
  seriesLabel,
  type ShareSelection,
  summaryLabel,
} from './feed-metrics'

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

describe('initialSeriesSelection', () => {
  it('keeps the representable series the post already shares, in canonical order', () => {
    expect(initialSeriesSelection({ include_chart: false, series_metrics: ['speed', 'heart_rate'] })).toEqual(
      ['heart_rate', 'speed'],
    )
  })

  it('folds a chart-image post into the heart-rate series (unified control)', () => {
    expect(initialSeriesSelection({ include_chart: true, series_metrics: [] })).toEqual(['heart_rate'])
    // Other shared series are kept; heart rate is appended once.
    expect(initialSeriesSelection({ include_chart: true, series_metrics: ['speed'] })).toEqual([
      'speed',
      'heart_rate',
    ])
  })

  it('does not duplicate heart rate when the post shares both the image and the series', () => {
    expect(initialSeriesSelection({ include_chart: true, series_metrics: ['heart_rate'] })).toEqual([
      'heart_rate',
    ])
  })

  it('shares nothing when neither the chart image nor any series is opted in', () => {
    expect(initialSeriesSelection({ include_chart: false, series_metrics: [] })).toEqual([])
  })
})

describe('buildShareBody', () => {
  const base: ShareSelection = {
    canChart: true,
    canMap: true,
    includeMap: false,
    series: new Set<MetricType>(),
    seriesOptions: [{ key: 'heart_rate' }, { key: 'speed' }],
    summary: new Set<string>(),
    summaryOptions: [{ key: 'duration' }, { key: 'heart_rate_avg' }],
    visibility: 'public',
  }

  it('attaches the chart image exactly when the heart-rate series is shared', () => {
    expect(buildShareBody({ ...base, series: new Set<MetricType>(['heart_rate']) })).toMatchObject({
      include_chart: true,
      series_metrics: ['heart_rate'],
    })
    expect(buildShareBody({ ...base, series: new Set<MetricType>(['speed']) })).toMatchObject({
      include_chart: false,
      series_metrics: ['speed'],
    })
  })

  it('never attaches a chart image the activity cannot render (no heart-rate data)', () => {
    const body = buildShareBody({ ...base, canChart: false, series: new Set<MetricType>(['heart_rate']) })
    // The series opt-in is still honoured; only the image is suppressed.
    expect(body).toMatchObject({ include_chart: false, series_metrics: ['heart_rate'] })
  })

  it('only sends metrics the dialog offered, and gates the map on GPS availability', () => {
    const body = buildShareBody({
      ...base,
      canMap: false,
      includeMap: true,
      summary: new Set(['duration', 'calories']), // calories not offered → dropped
    })
    expect(body.included_metrics).toEqual(['duration'])
    expect(body.include_map).toBe(false)
    expect(body.visibility).toBe('public')
  })
})

describe('metric labels', () => {
  it('resolves known labels and falls back to the raw key', () => {
    expect(summaryLabel('heart_rate_avg')).toBe('Avg HR')
    expect(seriesLabel('heart_rate')).toBe('Heart rate')
    expect(summaryLabel('unknown_key')).toBe('unknown_key')
  })
})
