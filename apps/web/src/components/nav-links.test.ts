import { connectableSources } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import {
  DATA_SOURCE_LINKS,
  isLinkActive,
  MENU_ALWAYS_SHOWN,
  MENU_PAGE_LINKS,
  menuPath,
  menuSwitches,
  NAV_SECTIONS,
  NAV_TOP_LINKS,
  type NavSectionId,
  pageTitleForPath,
  parseOpenSections,
  sectionForUrl,
  toggleHiddenPage,
  toggleSection,
  visibleLinks,
  visibleSections,
  withSectionOpen,
} from './nav-links'

const sectionLinks = (id: NavSectionId) => NAV_SECTIONS.find((s) => s.id === id)?.links ?? []

describe('NAV_TOP_LINKS and NAV_SECTIONS', () => {
  test('put Home and Add on top and five sections below', () => {
    expect(NAV_TOP_LINKS.map((l) => l.href)).toEqual(['/', '/add'])
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(['Log', 'Training', 'Explore', 'Sharing', 'Setup'])
  })

  test('list Strength first under Training', () => {
    expect(sectionLinks('training').map((l) => l.href)).toEqual([
      '/strength',
      '/training-load',
      '/routes',
      '/segments',
    ])
  })

  test('list Data sources once, as one link, with Admin last and admin-only', () => {
    const setup = sectionLinks('setup')
    expect(setup.map((l) => l.href)).toEqual([
      '/data-sources',
      '/activity-types',
      '/deduction-rules',
      '/reminders',
      '/admin',
    ])
    expect(setup.at(-1)?.adminOnly).toBe(true)
    expect(setup.find((l) => l.href === '/activity-types')?.label).toBe('Activity types')
  })

  test('MENU_PAGE_LINKS lists every page once, without Admin', () => {
    const hrefs = MENU_PAGE_LINKS.map((l) => l.href)
    expect(hrefs[0]).toBe('/')
    expect(hrefs).toContain('/strength')
    expect(hrefs).not.toContain('/admin')
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})

describe('menuPath', () => {
  test('strips the query, the hash and a trailing slash', () => {
    expect(menuPath('/meals/?a=1#b')).toBe('/meals')
    expect(menuPath('/')).toBe('/')
    expect(menuPath('')).toBe('/')
    expect(menuPath('/?x=1')).toBe('/')
  })
})

describe('isLinkActive', () => {
  test('matches the page and the pages under it', () => {
    expect(isLinkActive('/meals', '/meals')).toBe(true)
    expect(isLinkActive('/meals', '/meals/123')).toBe(true)
    expect(isLinkActive('/meals', '/meals/?date=1')).toBe(true)
    expect(isLinkActive('/data-sources', '/data-sources/oura')).toBe(true)
    expect(isLinkActive('/admin', '/admin/users')).toBe(true)
  })

  test('does not match a path that only shares a prefix', () => {
    expect(isLinkActive('/meals', '/mealsandmore')).toBe(false)
    expect(isLinkActive('/data', '/data-sources')).toBe(false)
  })

  test('matches Home only exactly', () => {
    expect(isLinkActive('/', '/')).toBe(true)
    expect(isLinkActive('/', '/?x=1')).toBe(true)
    expect(isLinkActive('/', '/meals')).toBe(false)
  })

  test('counts the shared dashboards as Dashboards', () => {
    expect(isLinkActive('/dashboards', '/shared-dashboards')).toBe(true)
    expect(isLinkActive('/dashboards', '/shared-dashboards/abc')).toBe(true)
    expect(isLinkActive('/dashboards', '/shared-dashboardsx')).toBe(false)
  })
})

describe('sectionForUrl', () => {
  test('finds the section of a page and of the pages under it', () => {
    expect(sectionForUrl('/journal')).toBe('log')
    expect(sectionForUrl('/strength/live')).toBe('training')
    expect(sectionForUrl('/correlations?x=1')).toBe('explore')
    expect(sectionForUrl('/shared-dashboards')).toBe('sharing')
    expect(sectionForUrl('/data-sources/oura')).toBe('setup')
    expect(sectionForUrl('/admin/users/maja')).toBe('setup')
  })

  test('is undefined for the top links and pages outside the sections', () => {
    expect(sectionForUrl('/')).toBeUndefined()
    expect(sectionForUrl('/add')).toBeUndefined()
    expect(sectionForUrl('/settings')).toBeUndefined()
  })
})

describe('visibleSections', () => {
  test('shows every section, without Admin for a non-admin', () => {
    const sections = visibleSections([], false)
    expect(sections).toHaveLength(NAV_SECTIONS.length)
    expect(sections.at(-1)?.links.map((l) => l.href)).not.toContain('/admin')
  })

  test('shows Admin to an admin, even when hidden', () => {
    const setup = visibleSections(['/admin'], true).find((s) => s.id === 'setup')
    expect(setup?.links.map((l) => l.href)).toContain('/admin')
  })

  test('leaves out hidden links', () => {
    const log = visibleSections(['/meals'], false).find((s) => s.id === 'log')
    expect(log?.links.map((l) => l.href)).toEqual(['/journal', '/check-ins', '/reports', '/people'])
  })

  test('drops a section with no visible links', () => {
    const hidden = sectionLinks('sharing').map((l) => l.href)
    expect(visibleSections(hidden, false).map((s) => s.id)).not.toContain('sharing')
    const setup = sectionLinks('setup').map((l) => l.href)
    expect(visibleSections(setup, false).map((s) => s.id)).not.toContain('setup')
    expect(visibleSections(setup, true).map((s) => s.id)).toContain('setup')
  })
})

describe('parseOpenSections', () => {
  test('reads a stored list of section ids', () => {
    expect(parseOpenSections('["log","setup"]')).toEqual(['log', 'setup'])
  })

  test('returns nothing for missing or malformed values', () => {
    expect(parseOpenSections(null)).toEqual([])
    expect(parseOpenSections('')).toEqual([])
    expect(parseOpenSections('not json')).toEqual([])
    expect(parseOpenSections('{"log":true}')).toEqual([])
    expect(parseOpenSections('"log"')).toEqual([])
  })

  test('keeps only known ids, once each', () => {
    expect(parseOpenSections('["log","nope",3,null,"log","sharing"]')).toEqual(['log', 'sharing'])
  })
})

describe('withSectionOpen and toggleSection', () => {
  test('withSectionOpen adds a section once', () => {
    expect(withSectionOpen([], 'log')).toEqual(['log'])
    expect(withSectionOpen(['log'], 'log')).toEqual(['log'])
    expect(withSectionOpen(['log'], 'setup')).toEqual(['log', 'setup'])
  })

  test('toggleSection opens and closes a section', () => {
    const open = toggleSection(['log'], 'setup')
    expect(open).toEqual(['log', 'setup'])
    expect(toggleSection(open, 'log')).toEqual(['setup'])
  })

  test('returns new arrays', () => {
    const open: NavSectionId[] = ['log']
    expect(withSectionOpen(open, 'log')).not.toBe(open)
    expect(toggleSection(open, 'setup')).not.toBe(open)
  })
})

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
    expect(pageTitleForPath('/add')).toBe('Add')
    expect(pageTitleForPath('/strength')).toBe('Strength')
    expect(pageTitleForPath('/activity-types')).toBe('Activity types')
    expect(pageTitleForPath('/data-sources')).toBe('Data sources')
    expect(pageTitleForPath('/admin')).toBe('Admin')
  })

  test('names pages that are not in the nav', () => {
    expect(pageTitleForPath('/settings')).toBe('Settings')
    expect(pageTitleForPath('/help')).toBe('Help & support')
    expect(pageTitleForPath('/reminders')).toBe('Reminders')
    expect(pageTitleForPath('/audit-log')).toBe('Audit log')
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
    expect(pageTitleForPath('/check-ins/abc/edit')).toBe('Check-ins')
    expect(pageTitleForPath('/people/abc')).toBe('People')
    expect(pageTitleForPath('/data-sources/unknown')).toBe('Data sources')
    expect(pageTitleForPath('/admin/users/maja')).toBe('Admin')
    expect(pageTitleForPath('/strength/live')).toBe('Strength session')
    expect(pageTitleForPath('/strength/log')).toBe('Strength session')
    expect(pageTitleForPath('/strength/session/abc')).toBe('Strength session')
    expect(pageTitleForPath('/strength/plan/new')).toBe('Strength plan')
    expect(pageTitleForPath('/strength/plan/abc')).toBe('Strength plan')
    expect(pageTitleForPath('/strength/workouts')).toBe('Strength')
    expect(pageTitleForPath('/strength/progress')).toBe('Strength')
    expect(pageTitleForPath('/strength/exercises')).toBe('Strength')
    expect(pageTitleForPath('/strength/muscles')).toBe('Strength')
  })

  test('falls back to Aurboda for unknown routes', () => {
    expect(pageTitleForPath('/sleep')).toBe('Aurboda')
    expect(pageTitleForPath('/mealsandmore')).toBe('Aurboda')
  })
})

describe('DATA_SOURCE_LINKS', () => {
  test('lists every card on the Data Sources overview that has its own page, in the same order', () => {
    const cardPaths = connectableSources.map((source) => source.path).filter((p) => p.startsWith('/'))
    const linkPaths = DATA_SOURCE_LINKS.map((l) => l.path).filter((p) => p !== '/data-sources')

    expect(cardPaths.length).toBeGreaterThan(0)
    expect(linkPaths).toEqual(cardPaths)
  })
})

describe('visibleLinks', () => {
  test('leaves out the hidden pages of an href list', () => {
    const shown = visibleLinks(MENU_PAGE_LINKS, ['/meals', '/chart']).map((l) => l.href)
    expect(shown).not.toContain('/meals')
    expect(shown).not.toContain('/chart')
    expect(shown).toContain('/goals')
    expect(shown).toHaveLength(MENU_PAGE_LINKS.length - 2)
  })

  test('leaves out the hidden pages of a path list', () => {
    const shown = visibleLinks(DATA_SOURCE_LINKS, ['/data-sources', '/data-sources/oura']).map((l) => l.path)
    expect(shown).not.toContain('/data-sources')
    expect(shown).not.toContain('/data-sources/oura')
    expect(shown).toHaveLength(DATA_SOURCE_LINKS.length - 2)
  })

  test('an unknown path in the hidden list changes nothing', () => {
    expect(visibleLinks(MENU_PAGE_LINKS, ['/no-such-page'])).toEqual(MENU_PAGE_LINKS)
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
    const sharing = sectionLinks('sharing')
    expect(
      visibleLinks(
        sharing,
        sharing.map((l) => l.href),
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
      'Log',
      'Training',
      'Explore',
      'Sharing',
      'Setup',
      'Only in the Android app',
    ])
    expect(groups.map((g) => g.id)).toEqual(['main', 'log', 'training', 'explore', 'sharing', 'setup', 'app'])
    expect(groups[0]?.switches.map((s) => s.path)).toEqual(['/add'])
    expect(groups[4]?.switches.map((s) => s.path)).toEqual(['/feed', '/dashboards', '/challenges'])
    expect(groups[5]?.switches.map((s) => s.path)).toEqual([
      '/data-sources',
      '/activity-types',
      '/deduction-rules',
      '/reminders',
    ])
  })

  test('offers no switch for the single data sources', () => {
    expect(paths.filter((p) => p.startsWith('/data-sources/'))).toEqual([])
  })

  test('offers no switch for the never-hidden pages', () => {
    for (const path of MENU_ALWAYS_SHOWN) expect(paths).not.toContain(path)
  })

  test('offers Check-ins and People under Log, and Strength under Training', () => {
    expect(groups[1]?.switches.map((s) => s.path)).toContain('/check-ins')
    expect(groups[1]?.switches.map((s) => s.path)).toContain('/people')
    expect(groups[2]?.switches.map((s) => s.path)).toContain('/strength')
  })

  test('covers the Android-only More entries', () => {
    expect(paths).toContain('/audit-log')
  })

  test('gives every switch a description', () => {
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
