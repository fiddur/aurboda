import type { NamedLocation } from '@aurboda/api-spec'

export const sortNamedPlaces = (locations: readonly NamedLocation[]): NamedLocation[] =>
  [...locations].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

export const describeNamedPlace = (location: NamedLocation): string =>
  `${location.radius} m · ${location.auto_create_activity ? 'creates activities' : 'no activities'}`

export const namedPlaceUpdateBody = (
  originalName: string,
  edits: { name: string; auto_create_activity: boolean },
): { name?: string; auto_create_activity: boolean } => {
  const name = edits.name.trim()
  return name && name !== originalName
    ? { auto_create_activity: edits.auto_create_activity, name }
    : { auto_create_activity: edits.auto_create_activity }
}
