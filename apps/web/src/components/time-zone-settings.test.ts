import { describe, expect, test } from 'vitest'

import { timeZoneSettingsView } from './time-zone-settings'

const supported = ['Asia/Kolkata', 'Europe/Stockholm', 'UTC']

describe('timeZoneSettingsView', () => {
  test('selects the stored zone and offers no "Not set" option once a zone is stored', () => {
    const view = timeZoneSettingsView('Europe/Stockholm', 'Europe/Stockholm', supported)
    expect(view.selected).toBe('Europe/Stockholm')
    expect(view.options.map((o) => o.value)).toEqual(supported)
  })

  test('selects a first "Not set (UTC)" option while unset', () => {
    const view = timeZoneSettingsView(null, 'Europe/Stockholm', supported)
    expect(view.selected).toBe('')
    expect(view.options[0]).toEqual({ label: 'Not set (UTC)', value: '' })
    expect(view.options.slice(1).map((o) => o.value)).toEqual(supported)
  })

  test('always offers UTC, also when the browser list lacks it', () => {
    const view = timeZoneSettingsView('Europe/Stockholm', null, ['Asia/Kolkata', 'Europe/Stockholm'])
    expect(view.options.map((o) => o.value)).toEqual(['UTC', 'Asia/Kolkata', 'Europe/Stockholm'])
  })

  test('adds a stored zone the list lacks', () => {
    const view = timeZoneSettingsView('Asia/Calcutta', null, supported)
    expect(view.options.map((o) => o.value)).toContain('Asia/Calcutta')
    expect(view.selected).toBe('Asia/Calcutta')
  })

  test('offers the browser zone only when it differs from the stored one', () => {
    expect(timeZoneSettingsView('Europe/Stockholm', 'Europe/Stockholm', supported).browserOffer).toBeNull()
    expect(timeZoneSettingsView('Asia/Kolkata', 'Europe/Stockholm', supported).browserOffer).toBe(
      'Europe/Stockholm',
    )
    expect(timeZoneSettingsView(null, 'Europe/Stockholm', supported).browserOffer).toBe('Europe/Stockholm')
    expect(timeZoneSettingsView('Asia/Kolkata', null, supported).browserOffer).toBeNull()
  })

  test('maps the chosen option to the value to save, the empty one to null', () => {
    const view = timeZoneSettingsView(null, null, supported)
    expect(view.toSave('')).toBeNull()
    expect(view.toSave('UTC')).toBe('UTC')
  })
})
