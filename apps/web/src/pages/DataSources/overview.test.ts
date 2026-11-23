import type { DataKindOverview, DataSourceOverviewItem, DataSourcesOverview } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { joinNames, otherSourcesCovering, overlapMessage, overlapNoteText, sourcesByGroup } from './overview'

const item = (
  id: DataSourceOverviewItem['id'],
  name: string,
  group: DataSourceOverviewItem['group'],
  kinds: DataSourceOverviewItem['kinds'],
  status: DataSourceOverviewItem['status'] = 'not_set_up',
): DataSourceOverviewItem => ({ detail: '', group, id, kinds, name, path: `/data-sources/${id}`, status })

const location = (active: DataKindOverview['active_sources']): DataKindOverview => ({
  active_sources: active,
  available_sources: ['owntracks', 'home_assistant'],
  id: 'location',
  label: 'Location',
  one_source_enough: true,
  overlap: active.length >= 2,
  overlap_hint: "your phone's position",
})

const sleep: DataKindOverview = {
  active_sources: ['oura', 'garmin'],
  available_sources: ['oura', 'garmin'],
  id: 'sleep',
  label: 'Sleep',
  one_source_enough: false,
  overlap: false,
  overlap_hint: null,
}

const overview = (
  owntracks: DataSourceOverviewItem['status'],
  homeAssistant: DataSourceOverviewItem['status'],
): DataSourcesOverview => {
  const sources = [
    item('oura', 'Oura Ring', 'health', ['sleep'], 'active'),
    item('garmin', 'Garmin', 'health', ['sleep'], 'active'),
    item('owntracks', 'OwnTracks', 'location', ['location'], owntracks),
    item('home_assistant', 'Home Assistant', 'location', ['location'], homeAssistant),
  ]
  return {
    groups: [
      { id: 'health', label: 'Health and sleep' },
      { id: 'workouts', label: 'Workouts' },
      { id: 'location', label: 'Location' },
    ],
    kinds: [
      location(sources.filter((s) => s.kinds.includes('location') && s.status === 'active').map((s) => s.id)),
      sleep,
    ],
    sources,
  }
}

describe('joinNames', () => {
  it('joins one, two and three names', () => {
    expect(joinNames(['A'])).toBe('A')
    expect(joinNames(['A', 'B'])).toBe('A and B')
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C')
  })
})

describe('overlapMessage', () => {
  const sources = overview('active', 'active').sources

  it('names both sources and what they send', () => {
    expect(overlapMessage(location(['home_assistant', 'owntracks']), sources)).toBe(
      "Home Assistant and OwnTracks both send your phone's position. One is enough.",
    )
  })

  it('says all for three or more', () => {
    const kind = { ...location(['home_assistant', 'owntracks', 'oura']) }
    expect(overlapMessage(kind, sources)).toBe(
      "Home Assistant, OwnTracks and Oura Ring all send your phone's position. One is enough.",
    )
  })
})

describe('otherSourcesCovering', () => {
  it('lists the other active source of a kind where one is enough', () => {
    const covering = otherSourcesCovering(overview('not_set_up', 'active'), 'owntracks')
    expect(covering.map(({ kind, others }) => [kind.id, others.map((o) => o.id)])).toEqual([
      ['location', ['home_assistant']],
    ])
  })

  it('is empty when no other source is active', () => {
    expect(otherSourcesCovering(overview('active', 'not_set_up'), 'owntracks')).toEqual([])
  })

  it('leaves out kinds where several sources are fine', () => {
    expect(otherSourcesCovering(overview('not_set_up', 'not_set_up'), 'oura')).toEqual([])
  })
})

describe('overlapNoteText', () => {
  it('warns before setting up a second source', () => {
    const data = overview('not_set_up', 'active')
    const [covering] = otherSourcesCovering(data, 'owntracks')
    expect(overlapNoteText(covering!, data.sources.find((s) => s.id === 'owntracks')!)).toBe(
      "You already get location from Home Assistant. OwnTracks would send your phone's position again. Set it up only to replace Home Assistant.",
    )
  })

  it('tells to disconnect one when both are active', () => {
    const data = overview('active', 'active')
    const [covering] = otherSourcesCovering(data, 'owntracks')
    expect(overlapNoteText(covering!, data.sources.find((s) => s.id === 'owntracks')!)).toBe(
      "Home Assistant also sends your phone's position. One is enough: disconnect the one you don't need.",
    )
  })
})

describe('sourcesByGroup', () => {
  it('keeps the group order and leaves out groups without sources', () => {
    expect(
      sourcesByGroup(overview('active', 'active')).map((g) => [g.id, g.sources.map((s) => s.id)]),
    ).toEqual([
      ['health', ['oura', 'garmin']],
      ['location', ['owntracks', 'home_assistant']],
    ])
  })
})
