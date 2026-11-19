export interface TimeZoneSettingsView {
  options: { label: string; value: string }[]
  selected: string
  browserOffer: string | null
  toSave: (value: string) => string | null
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
 */
export const timeZoneSettingsView = (
  stored: string | null,
  browser: string | null,
  supported: readonly string[],
): TimeZoneSettingsView => {
  const extra = ['UTC', ...(stored ? [stored] : [])].filter((zone) => !supported.includes(zone))
  const zones = [...new Set([...extra, ...supported])]
  return {
    browserOffer: browser && browser !== stored ? browser : null,
    options: [
      ...(stored ? [] : [{ label: 'Not set (UTC)', value: '' }]),
      ...zones.map((zone) => ({ label: zone, value: zone })),
    ],
    selected: stored ?? '',
    toSave: (value) => value || null,
  }
}
