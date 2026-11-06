import type { NamedLocation } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { describeNamedPlace, namedPlaceUpdateBody, sortNamedPlaces } from './namedPlaces'

const place = (name: string, overrides: Partial<NamedLocation> = {}): NamedLocation => ({
  id: `00000000-0000-4000-8000-${name.length.toString().padStart(12, '0')}`,
  lat: 59.33,
  lon: 18.07,
  name,
  radius: 100,
  ...overrides,
})

describe('sortNamedPlaces', () => {
  test('sorts by name, ignoring case', () => {
    const sorted = sortNamedPlaces([place('office'), place('Gym'), place('home'), place('Aunt')])
    expect(sorted.map((l) => l.name)).toEqual(['Aunt', 'Gym', 'home', 'office'])
  })

  test('does not mutate its input', () => {
    const input = [place('b'), place('a')]
    sortNamedPlaces(input)
    expect(input.map((l) => l.name)).toEqual(['b', 'a'])
  })
})

describe('describeNamedPlace', () => {
  test('shows the radius and whether visits create activities', () => {
    expect(describeNamedPlace(place('Home', { auto_create_activity: true, radius: 150 }))).toBe(
      '150 m · creates activities',
    )
    expect(describeNamedPlace(place('Home', { radius: 80 }))).toBe('80 m · no activities')
  })
})

describe('namedPlaceUpdateBody', () => {
  test('sends only the flag when the name is unchanged', () => {
    expect(namedPlaceUpdateBody('Home', { auto_create_activity: true, name: ' Home ' })).toEqual({
      auto_create_activity: true,
    })
  })

  test('sends the trimmed new name when it changed', () => {
    expect(namedPlaceUpdateBody('Home', { auto_create_activity: false, name: ' House ' })).toEqual({
      auto_create_activity: false,
      name: 'House',
    })
  })

  test('never sends an empty name', () => {
    expect(namedPlaceUpdateBody('Home', { auto_create_activity: false, name: '   ' })).toEqual({
      auto_create_activity: false,
    })
  })
})
