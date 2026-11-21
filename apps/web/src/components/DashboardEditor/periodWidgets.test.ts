import { describe, expect, it } from 'vitest'

import { appliesToPeriod, offeredWidgetTypes } from './periodWidgets'

describe('offeredWidgetTypes', () => {
  const templates = [
    { type: 'metric_card' as const },
    { type: 'last_sleep' as const },
    { type: 'goal_progress' as const },
    { type: 'sleep_debt' as const },
  ]

  it('offers everything on a rolling dashboard', () => {
    expect(offeredWidgetTypes(templates, false)).toEqual(templates)
  })

  it('hides last night, goal progress and sleep debt on a period dashboard', () => {
    expect(offeredWidgetTypes(templates, true)).toEqual([{ type: 'metric_card' }])
    expect(appliesToPeriod('activity_summary')).toBe(true)
    expect(appliesToPeriod('recent_activities')).toBe(true)
  })

  it('offers the day overview on every rolling dashboard, not on a period dashboard', () => {
    const withDay = [{ type: 'metric_card' as const }, { type: 'day_overview' as const }]
    expect(offeredWidgetTypes(withDay, false)).toEqual(withDay)
    expect(offeredWidgetTypes(withDay, true)).toEqual([{ type: 'metric_card' }])
  })
})
