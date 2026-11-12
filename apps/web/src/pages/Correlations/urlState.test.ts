import { describe, expect, test } from 'vitest'

import {
  type AnalyzeState,
  DEFAULT_ANALYZE_STATE,
  DEFAULT_EXPLORE_STATE,
  decodeSelector,
  encodeSelector,
  isExploreRunnable,
  parseAnalyzeState,
  withAnalyzeState,
} from './urlState'

const BASE = 'https://aurboda.example/correlations'

const FULL: AnalyzeState = {
  days: 60,
  explore: {
    days: 120,
    denominator: 'all',
    end: '2026-06-30',
    gap: 5,
    lagDays: 2,
    lags: '12h,24h',
    mode: 'continuous',
    nutrition: 'complete_only',
    outcome: { kind: 'metric', metric: 'sleep_score' },
    outcomeSource: 'tag',
    outcomeValue: 'headache',
    start: '2026-01-01',
    trigger: { kind: 'nutrition', nutrient: 'carbs' },
  },
  extras: ['body_battery'],
  item: { name: 'breathwork', type: 'activity_type' },
  metrics: ['hrv', 'stress'],
  tab: 'explore',
  window: 120,
}

const searchOf = (path: string) => new URL(path, BASE).search

describe('parseAnalyzeState', () => {
  test('is the default state for a plain URL', () => {
    expect(parseAnalyzeState('')).toEqual(DEFAULT_ANALYZE_STATE)
  })

  test('reads every param', () => {
    const search =
      '?tab=explore&days=60&window=120&metrics=hrv,stress,body_battery&item=breathwork&item_type=activity_type' +
      '&mode=continuous&trigger=nutrition:carbs&outcome=metric:sleep_score&outcome_source=tag' +
      '&outcome_value=headache&lags=12h,24h&lag_days=2&gap=5&nutrition=complete_only&denominator=all' +
      '&start=2026-01-01&end=2026-06-30&explore_days=120'
    expect(parseAnalyzeState(search)).toEqual(FULL)
  })

  test('falls back to defaults for invalid values', () => {
    const state = parseAnalyzeState(
      '?tab=hrv&days=45&window=7&metrics=Sleep,,&item_type=activity_type&mode=x&trigger=bogus:x' +
        '&outcome=nutrition:sugar&gap=-1&lag_days=abc&nutrition=some&start=yesterday&explore_days=0',
    )
    expect(state).toEqual(DEFAULT_ANALYZE_STATE)
  })

  test('needs both item and a valid item_type', () => {
    expect(parseAnalyzeState('?item=Office').item).toBeNull()
    expect(parseAnalyzeState('?item=Office&item_type=planet').item).toBeNull()
    expect(parseAnalyzeState('?item=Office&item_type=location').item).toEqual({
      name: 'Office',
      type: 'location',
    })
  })

  test('orders metrics canonically and drops unknown ones', () => {
    expect(parseAnalyzeState('?metrics=stress,steps,hr').metrics).toEqual(['hr', 'stress'])
  })

  test('other metric names are extras: at most four, valid, not cumulative or one of the three', () => {
    const state = parseAnalyzeState(
      '?metrics=hr,body_battery,Bad-Name,steps,heart_rate,spo2,body_battery,respiratory_rate,mood,skin_temp',
    )
    expect(state.metrics).toEqual(['hr'])
    expect(state.extras).toEqual(['body_battery', 'spo2', 'respiratory_rate', 'mood'])
  })

  test('extras alone leave the three off', () => {
    expect(parseAnalyzeState('?metrics=body_battery')).toMatchObject({
      extras: ['body_battery'],
      metrics: [],
    })
  })

  test('defaults the denominator from the outcome source', () => {
    expect(parseAnalyzeState('').explore.denominator).toBe('all')
    expect(parseAnalyzeState('?outcome_source=tag').explore.denominator).toBe('known')
    expect(parseAnalyzeState('?outcome_source=tag&denominator=all').explore.denominator).toBe('all')
  })
})

describe('withAnalyzeState', () => {
  test('leaves a default state out of the URL', () => {
    expect(withAnalyzeState(BASE, DEFAULT_ANALYZE_STATE)).toBe('/correlations')
  })

  test('round trips', () => {
    expect(parseAnalyzeState(searchOf(withAnalyzeState(BASE, FULL)))).toEqual(FULL)
  })

  test('leaves commas and colons readable', () => {
    const state = {
      ...DEFAULT_ANALYZE_STATE,
      explore: { ...DEFAULT_EXPLORE_STATE, trigger: { kind: 'activity' as const, pattern: 'yoga' } },
      metrics: ['hr' as const, 'stress' as const],
    }
    expect(withAnalyzeState(BASE, state)).toBe('/correlations?metrics=hr,stress&trigger=activity:yoga')
  })

  test('writes extras after the short keys', () => {
    const state = {
      ...DEFAULT_ANALYZE_STATE,
      extras: ['body_battery'],
      metrics: ['hr' as const, 'stress' as const],
    }
    expect(withAnalyzeState(BASE, state)).toBe('/correlations?metrics=hr,stress,body_battery')
  })

  test('omits the denominator when it is the outcome source default', () => {
    const state = {
      ...DEFAULT_ANALYZE_STATE,
      explore: { ...DEFAULT_EXPLORE_STATE, denominator: 'known' as const, outcomeSource: 'tag' as const },
    }
    expect(withAnalyzeState(BASE, state)).toBe('/correlations?outcome_source=tag')
  })

  test('keeps params it does not own and the hash', () => {
    const next = withAnalyzeState(`${BASE}?embed=1&foo=bar&days=14#top`, {
      ...DEFAULT_ANALYZE_STATE,
      tab: 'explore',
    })
    expect(next).toBe('/correlations?embed=1&foo=bar&tab=explore#top')
  })

  test('removes the selected item when it is cleared', () => {
    expect(withAnalyzeState(`${BASE}?embed=1&item=Office&item_type=location`, DEFAULT_ANALYZE_STATE)).toBe(
      '/correlations?embed=1',
    )
  })
})

describe('selector encoding', () => {
  test('round trips each kind', () => {
    for (const selector of [
      { kind: 'metric', metric: 'sleep_score' },
      { kind: 'activity', pattern: 'run' },
      { kind: 'nutrition', nutrient: 'fiber' },
      { kind: 'productivity_category', pattern: 'Software Development' },
      { kind: 'productivity_app', pattern: 'vscode' },
    ] as const) {
      expect(decodeSelector(encodeSelector(selector))).toEqual(selector)
    }
  })

  test('splits on the first colon, so a pattern may contain one', () => {
    expect(decodeSelector('activity:^a:b$')).toEqual({ kind: 'activity', pattern: '^a:b$' })
    expect(encodeSelector({ kind: 'activity', pattern: 'a:b' })).toBe('activity:a:b')
  })

  test('rejects unknown kinds, bad nutrients and missing separators', () => {
    expect(decodeSelector('planet:mars')).toBeNull()
    expect(decodeSelector('nutrition:sugar')).toBeNull()
    expect(decodeSelector('metric')).toBeNull()
  })
})

describe('isExploreRunnable', () => {
  test('needs a trigger and the active mode outcome', () => {
    expect(isExploreRunnable(DEFAULT_EXPLORE_STATE)).toBe(false)
    const trigger = { kind: 'activity' as const, pattern: 'alcohol' }
    expect(isExploreRunnable({ ...DEFAULT_EXPLORE_STATE, trigger })).toBe(false)
    expect(isExploreRunnable({ ...DEFAULT_EXPLORE_STATE, outcomeValue: 'headache', trigger })).toBe(true)
    expect(
      isExploreRunnable({ ...DEFAULT_EXPLORE_STATE, mode: 'continuous', outcomeValue: 'headache', trigger }),
    ).toBe(false)
    expect(isExploreRunnable(FULL.explore)).toBe(true)
  })
})
