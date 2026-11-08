import { describe, expect, test, vi } from 'vitest'

import type { ProductivityRecord, ScreentimeCategory } from '../../db/index.ts'

import { getTopApps, type TopAppsDeps } from './top-apps.ts'

const record = (activity: string, minutes: number, resolved_category?: string[]): ProductivityRecord => ({
  activity,
  duration_sec: minutes * 60,
  end_time: new Date('2026-10-02T10:00:00Z'),
  resolved_category,
  start_time: new Date('2026-10-02T09:00:00Z'),
})

const category = (name: string[], exclude_from_screentime?: boolean): ScreentimeCategory => ({
  created_at: new Date(0),
  exclude_from_screentime,
  id: name.join('/'),
  ignore_case: true,
  name,
  rule_type: 'none',
  sort_order: 0,
  updated_at: new Date(0),
})

const deps = (records: ProductivityRecord[], categories: ScreentimeCategory[] = []): TopAppsDeps => ({
  getProductivity: vi.fn().mockResolvedValue(records),
  getScreentimeCategories: vi.fn().mockResolvedValue(categories),
})

const window = { end: new Date('2026-11-01T00:00:00Z'), start: new Date('2026-10-01T00:00:00Z') }

describe('getTopApps', () => {
  test('sums the hours per app, most used first, to the limit', async () => {
    const d = deps([
      record('Firefox', 90),
      record('Terminal', 60),
      record('Firefox', 30),
      record('Slack', 10),
    ])

    const top = await getTopApps('u', window, 2, d)

    expect(top).toEqual({
      distinct_apps: 3,
      items: [
        { hours: 2, name: 'Firefox' },
        { hours: 1, name: 'Terminal' },
      ],
      total_hours: 3.2,
    })
    expect(d.getProductivity).toHaveBeenCalledWith('u', window.start, window.end)
  })

  test('leaves out records in an excluded category and its subcategories', async () => {
    const top = await getTopApps(
      'u',
      window,
      10,
      deps(
        [
          record('Firefox', 60, ['Work', 'Browsing']),
          record('Screensaver', 120, ['Idle']),
          record('Lock screen', 30, ['Idle', 'Locked']),
          record('Uncategorized app', 6),
        ],
        [category(['Idle'], true), category(['Work'])],
      ),
    )

    expect(top).toEqual({
      distinct_apps: 2,
      items: [
        { hours: 1, name: 'Firefox' },
        { hours: 0.1, name: 'Uncategorized app' },
      ],
      total_hours: 1.1,
    })
  })

  test('is empty without records', async () => {
    expect(await getTopApps('u', window, 3, deps([]))).toEqual({
      distinct_apps: 0,
      items: [],
      total_hours: 0,
    })
  })
})
