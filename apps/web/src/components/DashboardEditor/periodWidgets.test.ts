import { describe, expect, it } from 'vitest'

import { appliesToPeriod, offeredWidgetTypes } from './periodWidgets'

describe('offeredWidgetTypes', () => {
  const templates = [
    { type: 'metric_card' as const },
    { type: 'last_sleep' as const },
    { type: 'goal_progress' as const },
  ]

  it('offers everything on a rolling dashboard', () => {
    expect(offeredWidgetTypes(templates, false)).toEqual(templates)
  })

  it('hides last night and goal progress on a period dashboard', () => {
    expect(offeredWidgetTypes(templates, true)).toEqual([{ type: 'metric_card' }])
    expect(appliesToPeriod('activity_summary')).toBe(true)
  })
})
