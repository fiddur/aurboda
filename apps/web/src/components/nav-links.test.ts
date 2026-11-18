import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

import {
  DATA_SOURCE_LINKS,
  MENU_ALWAYS_SHOWN,
  menuSwitches,
  NAV_LINKS_PRIMARY,
  pageTitleForPath,
  SHARING_LINKS,
  toggleHiddenPage,
  visibleLinks,
} from './nav-links'

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
    expect(pageTitleForPath('/strength/live')).toBe('Strength session')
    expect(pageTitleForPath('/strength/plan/new')).toBe('Strength plan')
    expect(pageTitleForPath('/strength/plan/abc')).toBe('Strength plan')
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

describe('visibleLinks', () => {
  test('leaves out the hidden pages of an href list', () => {
    const shown = visibleLinks(NAV_LINKS_PRIMARY, ['/meals', '/chart']).map((l) => l.href)
    expect(shown).not.toContain('/meals')
    expect(shown).not.toContain('/chart')
    expect(shown).toContain('/goals')
    expect(shown).toHaveLength(NAV_LINKS_PRIMARY.length - 2)
  })

  test('leaves out the hidden pages of a path list', () => {
    const shown = visibleLinks(DATA_SOURCE_LINKS, ['/data-sources', '/data-sources/oura']).map((l) => l.path)
    expect(shown).not.toContain('/data-sources')
    expect(shown).not.toContain('/data-sources/oura')
    expect(shown).toHaveLength(DATA_SOURCE_LINKS.length - 2)
  })

  test('an unknown path in the hidden list changes nothing', () => {
    expect(visibleLinks(NAV_LINKS_PRIMARY, ['/no-such-page'])).toEqual(NAV_LINKS_PRIMARY)
  })

  test('a protected path in the hidden list is ignored', () => {
    const links = [
      { href: '/', label: 'Home' },
      { href: '/settings', label: 'Settings' },
      { href: '/help', label: 'Help' },
      { href: '/notifications', label: 'Notifications' },
      { href: '/admin', label: 'Admin' },
      { href: '/admin/users', label: 'Users' },
    ]
    expect(visibleLinks(links, [...MENU_ALWAYS_SHOWN, '/admin/users'])).toEqual(links)
  })

  test('hiding every child empties a group', () => {
    expect(
      visibleLinks(
        SHARING_LINKS,
        SHARING_LINKS.map((l) => l.href),
      ),
    ).toEqual([])
  })
})

describe('menuSwitches', () => {
  const groups = menuSwitches()
  const paths = groups.flatMap((g) => g.switches.map((s) => s.path))

  test('groups the switches as the menus show them', () => {
    expect(groups.map((g) => g.label)).toEqual([
      'Main',
      'Sharing',
      'More',
      'Data sources',
      'Only in the Android app',
    ])
    expect(groups[1]?.switches.map((s) => s.path)).toEqual(['/feed', '/dashboards', '/challenges'])
    expect(groups[3]?.switches[0]?.path).toBe('/data-sources')
  })

  test('offers no switch for the never-hidden pages', () => {
    for (const path of MENU_ALWAYS_SHOWN) expect(paths).not.toContain(path)
  })

  test('covers the Android-only More entries', () => {
    expect(paths).toContain('/reminders')
    expect(paths).toContain('/audit-log')
  })

  test('gives every switch a description and a label without the "+"', () => {
    for (const s of groups.flatMap((g) => g.switches)) expect(s.description).not.toBe('')
    expect(groups[0]?.switches.find((s) => s.path === '/add')?.label).toBe('Add')
  })

  test('lists each page once', () => {
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('toggleHiddenPage', () => {
  test('adds a page once and removes it again, keeping unknown paths', () => {
    const hidden = toggleHiddenPage(['/old-page'], '/meals', false)
    expect(hidden).toEqual(['/old-page', '/meals'])
    expect(toggleHiddenPage(hidden, '/meals', false)).toEqual(hidden)
    expect(toggleHiddenPage(hidden, '/meals', true)).toEqual(['/old-page'])
  })
})
