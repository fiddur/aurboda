import { describe, expect, test } from 'vitest'

import { scoreChartMenu } from './scoreChartMenu'

describe('scoreChartMenu', () => {
  test('the overall score', () => {
    const menu = scoreChartMenu('strength_score', 365)
    const explore = new URL(menu.exploreHref, 'http://x')
    expect(explore.pathname).toBe('/chart')
    expect(Object.fromEntries(explore.searchParams)).toMatchObject({
      aggregation: 'mean',
      chart_type: 'trend',
      display_period: 'daily',
      half_life_days: '7',
      lookback_days: '365',
      pattern: 'strength_score',
      source_type: 'metric',
    })
    expect(menu.widget('', 'w1')).toEqual({
      config: {
        aggregation: 'mean',
        display_period: 'daily',
        half_life_days: 7,
        lookback_days: 365,
        pattern: 'strength_score',
        source_type: 'metric',
      },
      id: 'w1',
      type: 'trend_chart',
    })
    expect(menu.sparkline('Score', 'w2')).toEqual({
      config: { lookback_days: 365, metric: 'strength_score', title: 'Score' },
      id: 'w2',
      type: 'sparkline_card',
    })
  })

  test('a group score', () => {
    const menu = scoreChartMenu('strength_score_chest', 90)
    expect(menu.widget('Chest', 'w1').config).toMatchObject({
      lookback_days: 90,
      pattern: 'strength_score_chest',
      title: 'Chest',
    })
    const goal = new URL(menu.goalHref, 'http://x')
    expect(goal.pathname).toBe('/goals')
    expect(Object.fromEntries(goal.searchParams)).toEqual({
      aggregation: 'mean',
      display_period: 'daily',
      half_life_days: '7',
      new: 'trend',
      pattern: 'strength_score_chest',
      source_type: 'metric',
    })
  })
})
