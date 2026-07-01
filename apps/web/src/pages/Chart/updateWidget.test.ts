import type { DashboardConfig, DashboardWidget } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { boardReturnPath, chartWidgetTitle, parseChartOrigin, replaceWidgetInConfig } from './updateWidget'

const trendWidget = (id: string, title?: string): DashboardWidget => ({
  config: { pattern: 'coffee', source_type: 'activity_type', ...(title ? { title } : {}) },
  id,
  type: 'trend_chart',
})

const config: DashboardConfig = {
  sections: [
    { id: 'sec-1', title: 'Charts', type: 'charts', widgets: [trendWidget('w-1'), trendWidget('w-2')] },
    { id: 'sec-2', title: 'More', type: 'charts', widgets: [trendWidget('w-3')] },
  ],
  version: 1,
}

describe('parseChartOrigin', () => {
  test('returns null when any origin param is missing', () => {
    expect(parseChartOrigin({})).toBeNull()
    expect(parseChartOrigin({ board_id: 'home', section_id: 'sec-1' })).toBeNull()
    expect(parseChartOrigin({ board_id: 'home', widget_id: 'w-1' })).toBeNull()
    expect(parseChartOrigin({ section_id: 'sec-1', widget_id: 'w-1' })).toBeNull()
  })

  test('parses a full origin', () => {
    expect(parseChartOrigin({ board_id: 'home', section_id: 'sec-1', widget_id: 'w-1' })).toEqual({
      board_id: 'home',
      section_id: 'sec-1',
      widget_id: 'w-1',
    })
  })
})

describe('boardReturnPath', () => {
  test('returns the home dashboard path for the home board', () => {
    expect(boardReturnPath({ board_id: 'home', section_id: 's', widget_id: 'w' }, 'fiddur', 'abc')).toBe('/')
  })

  test('returns the owner shared-dashboard path for a shared board', () => {
    expect(boardReturnPath({ board_id: 'sd-1', section_id: 's', widget_id: 'w' }, 'fiddur', 'abc')).toBe(
      '/u/fiddur/abc',
    )
  })

  test('url-encodes the username', () => {
    expect(boardReturnPath({ board_id: 'sd-1', section_id: 's', widget_id: 'w' }, 'a b', 'abc')).toBe(
      '/u/a%20b/abc',
    )
  })
})

describe('chartWidgetTitle', () => {
  test('returns the title of a chart widget', () => {
    expect(chartWidgetTitle(trendWidget('w-1', 'Morning coffee'))).toBe('Morning coffee')
  })

  test('returns undefined when the chart widget has no title', () => {
    expect(chartWidgetTitle(trendWidget('w-1'))).toBeUndefined()
  })

  test('returns undefined for non-chart widgets', () => {
    const link: DashboardWidget = { config: { href: '/x', label: 'X' }, id: 'l-1', type: 'quick_link' }
    expect(chartWidgetTitle(link)).toBeUndefined()
  })
})

describe('replaceWidgetInConfig', () => {
  test('replaces only the matching widget in the matching section', () => {
    const replacement = trendWidget('w-1', 'Updated')
    const next = replaceWidgetInConfig(config, 'sec-1', 'w-1', replacement)

    expect(next.sections[0].widgets[0]).toBe(replacement)
    expect(next.sections[0].widgets[1].id).toBe('w-2')
    expect(next.sections[1].widgets[0].id).toBe('w-3')
  })

  test('does not mutate the original config', () => {
    const before = structuredClone(config)
    replaceWidgetInConfig(config, 'sec-1', 'w-1', trendWidget('w-1', 'Updated'))
    expect(config).toEqual(before)
  })

  test('leaves the config unchanged when the section id is unknown', () => {
    const next = replaceWidgetInConfig(config, 'missing', 'w-1', trendWidget('w-1', 'Updated'))
    expect(next.sections[0].widgets[0].id).toBe('w-1')
    expect(chartWidgetTitle(next.sections[0].widgets[0])).toBeUndefined()
  })

  test('leaves the config unchanged when the widget id is unknown', () => {
    const next = replaceWidgetInConfig(config, 'sec-1', 'missing', trendWidget('missing', 'Updated'))
    expect(next.sections[0].widgets.map((w) => w.id)).toEqual(['w-1', 'w-2'])
  })
})
