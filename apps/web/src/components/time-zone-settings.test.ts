import { describe, expect, test } from 'vitest'

import { timeZoneSettingsView } from './time-zone-settings'

const supported = ['Asia/Kolkata', 'Europe/Stockholm', 'UTC']

describe('timeZoneSettingsView', () => {
  test('selects the stored zone and offers no "Not set" option once a zone is stored', () => {
    const view = timeZoneSettingsView('Europe/Stockholm', 'Europe/Stockholm', supported, true)
    expect(view.selected).toBe('Europe/Stockholm')
    expect(view.options.map((o) => o.value)).toEqual(supported)
  })

  test('selects a first "Not set (UTC)" option while unset', () => {
    const view = timeZoneSettingsView(null, 'Europe/Stockholm', supported, true)
    expect(view.selected).toBe('')
    expect(view.options[0]).toEqual({ label: 'Not set (UTC)', value: '' })
    expect(view.options.slice(1).map((o) => o.value)).toEqual(supported)
  })

  test('always offers UTC, also when the browser list lacks it', () => {
    const view = timeZoneSettingsView('Europe/Stockholm', null, ['Asia/Kolkata', 'Europe/Stockholm'], true)
    expect(view.options.map((o) => o.value)).toEqual(['UTC', 'Asia/Kolkata', 'Europe/Stockholm'])
  })

  test('adds a stored zone the list lacks', () => {
    const view = timeZoneSettingsView('Asia/Calcutta', null, supported, true)
    expect(view.options.map((o) => o.value)).toContain('Asia/Calcutta')
    expect(view.selected).toBe('Asia/Calcutta')
  })

  test('offers the browser zone only when it differs from the stored one', () => {
    expect(
      timeZoneSettingsView('Europe/Stockholm', 'Europe/Stockholm', supported, true).browserOffer,
    ).toBeNull()
    expect(timeZoneSettingsView('Asia/Kolkata', 'Europe/Stockholm', supported, true).browserOffer).toBe(
      'Europe/Stockholm',
    )
    expect(timeZoneSettingsView(null, 'Europe/Stockholm', supported, true).browserOffer).toBe(
      'Europe/Stockholm',
    )
    expect(timeZoneSettingsView('Asia/Kolkata', null, supported, true).browserOffer).toBeNull()
  })

  test('saves a chosen zone as a choice by hand, and the empty option as a clear', () => {
    const view = timeZoneSettingsView(null, null, supported, true)
    expect(view.toSave('')).toEqual({ tz: null })
    expect(view.toSave('UTC')).toEqual({ tz: 'UTC', tz_follows_device: false })
  })

  test("following the phone's zone saves only the switch", () => {
    const view = timeZoneSettingsView('Europe/Stockholm', null, supported, false)
    expect(view.followsDevice).toBe(false)
    expect(view.followToSave(true)).toEqual({ tz_follows_device: true })
    expect(view.followToSave(false)).toEqual({ tz_follows_device: false })
    expect(timeZoneSettingsView('Europe/Stockholm', null, supported, true).followsDevice).toBe(true)
  })
})
