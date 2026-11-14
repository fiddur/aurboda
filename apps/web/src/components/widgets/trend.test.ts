import { describe, expect, test } from 'vitest'

import { trendLabel, trendTone, widgetMetricBetter } from './trend'

describe('trendTone', () => {
  test('a rise is better where higher is better and worse where lower is better', () => {
    expect(trendTone(5, 'higher')).toBe('better')
    expect(trendTone(-5, 'higher')).toBe('worse')
    expect(trendTone(5, 'lower')).toBe('worse')
    expect(trendTone(-5, 'lower')).toBe('better')
  })

  test('a neutral metric and an unchanged value are neutral either way', () => {
    expect(trendTone(5, 'neutral')).toBe('neutral')
    expect(trendTone(-5, 'neutral')).toBe('neutral')
    expect(trendTone(0, 'higher')).toBe('neutral')
  })
})

describe('trendLabel', () => {
  test('says the direction and, unless neutral, better or worse', () => {
    expect(trendLabel(-12, 'better')).toBe('12.0% lower, better')
    expect(trendLabel(3.25, 'worse')).toBe('3.3% higher, worse')
    expect(trendLabel(4, 'neutral')).toBe('4.0% higher')
    expect(trendLabel(0, 'neutral')).toBe('unchanged')
    expect(trendLabel(-2, 'worse', '2 bpm')).toBe('2 bpm lower, worse')
  })
})

describe('widgetMetricBetter', () => {
  test('takes the direction of the built-in metric, pseudo-metrics included', () => {
    expect(widgetMetricBetter('resting_heart_rate')).toBe('lower')
    expect(widgetMetricBetter('rhr_7day')).toBe('lower')
    expect(widgetMetricBetter('hrv_30day')).toBe('higher')
    expect(widgetMetricBetter('sleep_score')).toBe('higher')
    expect(widgetMetricBetter('weight')).toBe('neutral')
    expect(widgetMetricBetter('zone2_weekly')).toBe('neutral')
  })

  test('takes a custom metric from its definition, neutral when unset or unknown', () => {
    const custom = [
      { better: 'lower' as const, name: 'pain', unit: 'score' },
      { name: 'mood', unit: 'score' },
    ]
    expect(widgetMetricBetter('pain', custom)).toBe('lower')
    expect(widgetMetricBetter('mood', custom)).toBe('neutral')
    expect(widgetMetricBetter('unknown', custom)).toBe('neutral')
  })

  test("the widget's trend_inverse overrides the metric", () => {
    expect(widgetMetricBetter('weight', [], true)).toBe('lower')
    expect(widgetMetricBetter('steps', [], true)).toBe('lower')
    expect(widgetMetricBetter('resting_heart_rate', [], false)).toBe('lower')
  })
})
