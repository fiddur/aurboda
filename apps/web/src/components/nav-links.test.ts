import { describe, expect, test } from 'vitest'

import { pageTitleForPath } from './nav-links'

describe('pageTitleForPath', () => {
  test('uses the nav label of the current route', () => {
    expect(pageTitleForPath('/')).toBe('Home')
    expect(pageTitleForPath('/timeline')).toBe('Timeline')
    expect(pageTitleForPath('/correlations')).toBe('Analyze')
    expect(pageTitleForPath('/dashboards')).toBe('Dashboards')
    expect(pageTitleForPath('/shared-dashboards')).toBe('Dashboards')
    expect(pageTitleForPath('/data-sources/oura')).toBe('Oura Ring')
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
    expect(pageTitleForPath('/data-sources/unknown')).toBe('Data Sources')
    expect(pageTitleForPath('/admin/users/maja')).toBe('Admin')
  })

  test('falls back to Aurboda for unknown routes', () => {
    expect(pageTitleForPath('/sleep')).toBe('Aurboda')
    expect(pageTitleForPath('/mealsandmore')).toBe('Aurboda')
  })
})
