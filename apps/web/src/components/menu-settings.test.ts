import { describe, expect, test } from 'vitest'

import { menuSettingsView } from './menu-settings'

const switchFor = (view: ReturnType<typeof menuSettingsView>, path: string) =>
  view.groups.flatMap((g) => g.switches).find((s) => s.path === path)

describe('menuSettingsView', () => {
  test('shows every switch on when nothing is hidden', () => {
    const view = menuSettingsView([])
    expect(view.hiddenCount).toBe(0)
    expect(view.groups.every((g) => g.switches.every((s) => s.shown))).toBe(true)
  })

  test('turns off the switches of hidden pages and counts them', () => {
    const view = menuSettingsView(['/meals', '/feed', '/dashboards', '/challenges'])
    expect(switchFor(view, '/meals')?.shown).toBe(false)
    expect(switchFor(view, '/feed')?.shown).toBe(false)
    expect(switchFor(view, '/goals')?.shown).toBe(true)
    expect(view.hiddenCount).toBe(4)
  })

  test('groups the switches by menu section', () => {
    const view = menuSettingsView(['/strength'])
    expect(view.groups.map((g) => g.id)).toEqual([
      'main',
      'log',
      'training',
      'explore',
      'sharing',
      'setup',
      'app',
    ])
    expect(view.groups.find((g) => g.id === 'training')?.switches[0]).toMatchObject({
      path: '/strength',
      shown: false,
    })
    expect(switchFor(view, '/admin')).toBeUndefined()
  })

  test('does not count unknown or protected paths', () => {
    const view = menuSettingsView(['/no-such-page', '/settings', '/'])
    expect(view.hiddenCount).toBe(0)
    expect(switchFor(view, '/settings')).toBeUndefined()
  })
})
