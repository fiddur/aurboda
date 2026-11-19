import type { DashboardConfig } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { setVisibleToVisitors } from './visibleToVisitors'

const config: DashboardConfig = {
  sections: [
    {
      id: 's1',
      title: 'Today',
      type: 'charts',
      widgets: [
        { config: { metrics: ['stress_level'], window: 'today' }, id: 'day', type: 'day_overview' },
        { config: { metric: 'hrv_7day', title: 'HRV' }, id: 'mc', type: 'metric_card' },
      ],
    },
  ],
  version: 1,
}

describe('setVisibleToVisitors', () => {
  it('sets the switch on the one day overview and keeps the rest of its config', () => {
    const on = setVisibleToVisitors(config, 'day', true)
    expect(on.sections[0]?.widgets[0]).toEqual({
      config: { metrics: ['stress_level'], visible_to_visitors: true, window: 'today' },
      id: 'day',
      type: 'day_overview',
    })
    expect(on.sections[0]?.widgets[1]).toBe(config.sections[0]?.widgets[1])
    expect(setVisibleToVisitors(on, 'day', false).sections[0]?.widgets[0]).toMatchObject({
      config: { visible_to_visitors: false },
    })
    expect(config.sections[0]?.widgets[0]?.config).not.toHaveProperty('visible_to_visitors')
  })

  it('leaves other widgets alone', () => {
    expect(setVisibleToVisitors(config, 'mc', true)).toEqual(config)
  })
})
