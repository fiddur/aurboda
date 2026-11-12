import type { ImpactBucket, WindowEffect } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  buildImpactSvg,
  IMPACT_HEIGHT,
  IMPACT_WIDTH,
  type ImpactSvgData,
  paddedDomain,
} from './impact-svg.ts'

const stats = (mean: number | null) => ({
  mean,
  occurrences: mean == null ? 0 : 4,
  sample_count: 8,
  stddev: null,
})

const bucket = (
  phase: ImpactBucket['phase'],
  start: number,
  end: number,
  hrv: number | null,
  hr: number | null,
  stress: number | null,
): ImpactBucket => ({
  end_offset_minutes: end,
  hr: stats(hr),
  hrv: stats(hrv),
  phase,
  start_offset_minutes: start,
  stress: stats(stress),
})

const effect = (overrides: Partial<WindowEffect> = {}): WindowEffect => ({
  after_mean: 50,
  before_mean: 45,
  change: 5,
  change_stddev: 2,
  p_value: 0.01,
  paired_occurrences: 4,
  ...overrides,
})

const noEffect = effect({
  after_mean: null,
  before_mean: null,
  change: null,
  p_value: null,
  paired_occurrences: 0,
})

const data: ImpactSvgData = {
  activity: 'yoga',
  avg_duration_min: 42.4,
  hr_effect: effect({ after_mean: 62, before_mean: 70, change: -8 }),
  hrv_effect: effect(),
  occurrences: 6,
  stress_effect: noEffect,
  timeline: [
    bucket('before', -30, -15, 44, 70, 30),
    bucket('before', -15, 0, 46, 69, null),
    bucket('during', 0, 0, 40, 90, 50),
    bucket('after', 0, 15, 52, 63, 25),
    bucket('after', 15, 30, 55, 61, 22),
  ],
  window_minutes: 30,
}

describe('buildImpactSvg', () => {
  test('a dark card at the default size', () => {
    const svg = buildImpactSvg(data)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain(`viewBox="0 0 ${IMPACT_WIDTH} ${IMPACT_HEIGHT}"`)
    expect(svg).toContain('fill="#0b0f19" rx="16"')
  })

  test('titles the chart with the activity, occurrences and average duration', () => {
    const svg = buildImpactSvg(data)
    expect(svg).toContain('Impact of &quot;yoga&quot;')
    expect(svg).toContain('6 occurrences, avg 42 min')
  })

  test('draws a dot per non-null mean in each series colour', () => {
    const svg = buildImpactSvg(data)
    expect(svg.match(/<circle [^>]*fill="#10b981"/g)).toHaveLength(5 + 1)
    expect(svg.match(/<circle [^>]*fill="#ef4444"/g)).toHaveLength(5 + 1)
    expect(svg.match(/<circle [^>]*fill="#f59e0b"/g)).toHaveLength(4 + 1)
  })

  test('breaks a line where a mean is missing', () => {
    const svg = buildImpactSvg(data, { bare: true })
    expect(svg.match(/<polyline [^>]*stroke="#10b981"/g)).toHaveLength(1)
    expect(svg.match(/<polyline [^>]*stroke="#f59e0b"/g)).toHaveLength(1)
  })

  test('gives each series its own y scale', () => {
    const svg = buildImpactSvg(data, { bare: true })
    const ys = (color: string) =>
      [...svg.matchAll(new RegExp(`<circle cx="[^"]+" cy="([^"]+)" r="6" fill="${color}"`, 'g'))].map((m) =>
        Number(m[1]),
      )
    const hrv = ys('#10b981')
    const hr = ys('#ef4444')
    expect(Math.max(...hrv) - Math.min(...hrv)).toBeCloseTo(Math.max(...hr) - Math.min(...hr), 0)
  })

  test('marks the during bucket with a translucent band', () => {
    expect(buildImpactSvg(data)).toMatch(/<rect [^>]*fill="#3b82f6" fill-opacity="0.15"/)
  })

  test('labels the buckets under the axis', () => {
    const svg = buildImpactSvg(data)
    for (const label of ['-30 min', '-15 min', 'During', '+15 min', '+30 min']) {
      expect(svg).toContain(`>${label}<`)
    }
  })

  test('has a legend and an effect line only for each effect with paired occurrences', () => {
    const svg = buildImpactSvg(data)
    for (const label of ['HRV', 'Heart rate', 'Stress', 'Activity period']) {
      expect(svg).toContain(`>${label}<`)
    }
    expect(svg).toContain('Heart rate 70.0 → 62.0 (−8.0) · 4 of 6 occurrences')
    expect(svg).toContain('HRV 45.0 → 50.0 (+5.0) · 4 of 6 occurrences')
    expect(svg).not.toContain('Stress --')
    expect(svg.indexOf('Heart rate 70.0')).toBeLessThan(svg.indexOf('HRV 45.0'))
  })

  test('bare draws no text and no background', () => {
    const svg = buildImpactSvg(data, { bare: true })
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('#0b0f19')
    expect(svg).toContain('<polyline')
  })

  test('escapes the activity name', () => {
    expect(buildImpactSvg({ ...data, activity: 'coffee <& tea>' })).toContain('coffee &lt;&amp; tea&gt;')
  })
})

describe('paddedDomain', () => {
  test('pads by 30 % of the range, or by 10 when flat', () => {
    expect(paddedDomain([40, null, 50])).toEqual([37, 53])
    expect(paddedDomain([60, 60])).toEqual([50, 70])
    expect(paddedDomain([null])).toEqual([0, 100])
  })
})
