import type { UpdateSettingsInput } from '@aurboda/api-spec'

export interface TimeZoneSettingsView {
  options: { label: string; value: string }[]
  selected: string
  browserOffer: string | null
  followsDevice: boolean
  toSave: (value: string) => UpdateSettingsInput
  followToSave: (follow: boolean) => UpdateSettingsInput
}

export const supportedTimezones = (): string[] => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

/**
 * "Not set" is offered only while nothing is stored: the browser's zone is adopted for an unset
 * user on the next page load, so choosing it would not stick. UTC is always a zone to choose.
 * A zone picked here is a choice by hand, so the phone stops replacing it; following the phone again
 * leaves the zone as it is until the Android app's next sync.
 */
export const timeZoneSettingsView = (
  stored: string | null,
  browser: string | null,
  supported: readonly string[],
  followsDevice: boolean,
): TimeZoneSettingsView => {
  const extra = ['UTC', ...(stored ? [stored] : [])].filter((zone) => !supported.includes(zone))
  const zones = [...new Set([...extra, ...supported])]
  return {
    browserOffer: browser && browser !== stored ? browser : null,
    options: [
      ...(stored ? [] : [{ label: 'Not set (UTC)', value: '' }]),
      ...zones.map((zone) => ({ label: zone, value: zone })),
    ],
    followToSave: (follow) => ({ tz_follows_device: follow }),
    followsDevice,
    selected: stored ?? '',
    toSave: (value) => (value ? { tz: value, tz_follows_device: false } : { tz: null }),
  }
}
