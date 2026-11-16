import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

import { DATA_SOURCE_LINKS, pageTitleForPath } from './nav-links'

describe('pageTitleForPath', () => {
  test('uses the nav label of the current route', () => {
    expect(pageTitleForPath('/')).toBe('Home')
    expect(pageTitleForPath('/timeline')).toBe('Timeline')
    expect(pageTitleForPath('/correlations')).toBe('Analyze')
    expect(pageTitleForPath('/training-load')).toBe('Training load')
    expect(pageTitleForPath('/segments')).toBe('Segments')
    expect(pageTitleForPath('/dashboards')).toBe('Dashboards')
    expect(pageTitleForPath('/shared-dashboards')).toBe('Dashboards')
    expect(pageTitleForPath('/data-sources/oura')).toBe('Oura Ring')
    expect(pageTitleForPath('/data-sources/gravl')).toBe('Gravl')
  })

  test('drops the "+" from the Add link', () => {
    expect(pageTitleForPath('/add')).toBe('Add')
  })

  test('names pages that are not in the nav', () => {
    expect(pageTitleForPath('/data-sources')).toBe('Data Sources')
    expect(pageTitleForPath('/settings')).toBe('Settings')
    expect(pageTitleForPath('/help')).toBe('Help & support')
  })

  test('ignores the query string, hash and a trailing slash', () => {
    expect(pageTitleForPath('/timeline?date=2026-11-01')).toBe('Timeline')
    expect(pageTitleForPath('/goals#weekly')).toBe('Goals')
    expect(pageTitleForPath('/meals/')).toBe('Meals')
  })

  test('falls back to the parent section for nested routes', () => {
    expect(pageTitleForPath('/reports/add')).toBe('Reports')
    expect(pageTitleForPath('/meals/123')).toBe('Meals')
    expect(pageTitleForPath('/segments/123')).toBe('Segments')
    expect(pageTitleForPath('/data-sources/unknown')).toBe('Data Sources')
    expect(pageTitleForPath('/admin/users/maja')).toBe('Admin')
  })

  test('falls back to Aurboda for unknown routes', () => {
    expect(pageTitleForPath('/sleep')).toBe('Aurboda')
    expect(pageTitleForPath('/mealsandmore')).toBe('Aurboda')
  })
})

describe('DATA_SOURCE_LINKS', () => {
  test('lists every card on the Data Sources overview, in the same order', () => {
    const overview = readFileSync(new URL('../pages/DataSources/index.tsx', import.meta.url), 'utf8')
    const cardPaths = [...overview.matchAll(/path: '(\/data-sources\/[^']+)'/g)].map((m) => m[1])
    const linkPaths = DATA_SOURCE_LINKS.map((l) => l.path).filter((p) => p !== '/data-sources')

    expect(cardPaths.length).toBeGreaterThan(0)
    expect(linkPaths).toEqual(cardPaths)
  })
})
