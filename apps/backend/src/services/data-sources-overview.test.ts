import {
  connectableSources,
  dataKindIds,
  dataKinds,
  dataSourceGroupIds,
  dataSourceGroups,
  dataSourceIds,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import type { RecentSourceActivity } from '../db/index.ts'

import {
  buildDataSourcesOverview,
  type DataSourceSignals,
  getDataSourcesOverview,
  type SourceSettings,
} from './data-sources-overview.ts'

const noSettings: SourceSettings = {
  calendars: [],
  garmin_connected: false,
  gravl_connection: null,
  home_assistant_entity_id: null,
  home_assistant_token_set: false,
  home_assistant_url: null,
  lastfm_username: null,
  oura_connected: false,
  rescue_time_key: null,
  strava_connected: false,
}

const noActivity: RecentSourceActivity = { health_connect: false, location_sources: [], productivity: [] }

const signals = (
  settings: Partial<SourceSettings> = {},
  activity: Partial<RecentSourceActivity> = {},
): DataSourceSignals => ({
  activity: { ...noActivity, ...activity },
  settings: { ...noSettings, ...settings },
})

const homeAssistant: Partial<SourceSettings> = {
  home_assistant_entity_id: 'person.me',
  home_assistant_token_set: true,
  home_assistant_url: 'https://ha.example.org',
}

const kind = (overview: ReturnType<typeof buildDataSourcesOverview>, id: string) =>
  overview.kinds.find((k) => k.id === id)!

const source = (overview: ReturnType<typeof buildDataSourcesOverview>, id: string) =>
  overview.sources.find((s) => s.id === id)!

describe('the connectable sources catalogue', () => {
  test('lists every source once, in id order, with known kinds and a known group', () => {
    expect(connectableSources.map((s) => s.id)).toEqual([...dataSourceIds])
    for (const s of connectableSources) {
      expect(dataSourceGroupIds).toContain(s.group)
      for (const k of s.kinds) expect(dataKindIds).toContain(k)
    }
  })

  test('every kind and every group has a source', () => {
    expect(dataKinds.map((k) => k.id)).toEqual([...dataKindIds])
    expect(dataSourceGroups.map((g) => g.id)).toEqual([...dataSourceGroupIds])
    for (const k of dataKindIds) expect(connectableSources.some((s) => s.kinds.includes(k))).toBe(true)
    for (const g of dataSourceGroupIds) expect(connectableSources.some((s) => s.group === g)).toBe(true)
  })

  test('a kind where one source is enough says what two of them both send', () => {
    for (const k of dataKinds.filter((d) => d.one_source_enough)) expect(k.overlap_hint).toBeTruthy()
  })
})

describe('buildDataSourcesOverview', () => {
  test('Home Assistant and OwnTracks both active overlap on location', () => {
    const overview = buildDataSourcesOverview(signals(homeAssistant, { location_sources: ['owntracks'] }))

    expect(kind(overview, 'location')).toEqual({
      active_sources: ['owntracks', 'home_assistant'],
      available_sources: ['owntracks', 'home_assistant'],
      id: 'location',
      label: 'Location',
      one_source_enough: true,
      overlap: true,
      overlap_hint: "your phone's position",
    })
    expect(source(overview, 'owntracks')).toMatchObject({
      detail: 'Data received in the last 7 days',
      status: 'active',
    })
    expect(source(overview, 'home_assistant')).toMatchObject({ detail: 'Connected', status: 'active' })
  })

  test('one location source is no overlap', () => {
    const overview = buildDataSourcesOverview(signals(homeAssistant))

    expect(kind(overview, 'location')).toMatchObject({ active_sources: ['home_assistant'], overlap: false })
    expect(source(overview, 'owntracks')).toMatchObject({
      detail: 'No data in the last 7 days',
      status: 'not_set_up',
    })
  })

  test('Home Assistant without a picked entity is not active', () => {
    const overview = buildDataSourcesOverview(signals({ ...homeAssistant, home_assistant_entity_id: null }))

    expect(source(overview, 'home_assistant')).toMatchObject({
      detail: 'Not connected',
      status: 'not_set_up',
    })
  })

  test('Garmin and Oura both feed sleep without an overlap warning', () => {
    const overview = buildDataSourcesOverview(signals({ garmin_connected: true, oura_connected: true }))

    expect(kind(overview, 'sleep')).toMatchObject({
      active_sources: ['oura', 'garmin'],
      available_sources: ['android_app', 'oura', 'garmin'],
      one_source_enough: false,
      overlap: false,
      overlap_hint: null,
    })
  })

  test('a RescueTime key without recent data is configured', () => {
    const overview = buildDataSourcesOverview(signals({ rescue_time_key: 'key' }))

    expect(source(overview, 'rescuetime')).toMatchObject({
      detail: 'Configured, no recent data',
      status: 'configured',
    })
    expect(kind(overview, 'computer_screen_time').active_sources).toEqual([])
  })

  test('ActivityWatch on the desktop and RescueTime overlap on computer screen time', () => {
    const overview = buildDataSourcesOverview(
      signals(
        { rescue_time_key: 'key' },
        {
          productivity: [
            { is_mobile: false, source: 'activitywatch' },
            { is_mobile: false, source: 'rescuetime' },
          ],
        },
      ),
    )

    expect(kind(overview, 'computer_screen_time')).toMatchObject({
      active_sources: ['activitywatch_desktop', 'rescuetime'],
      overlap: true,
      overlap_hint: "your computer's app usage",
    })
    expect(source(overview, 'activitywatch_android').status).toBe('not_set_up')
  })

  test('ActivityWatch on a phone counts as phone screen time only', () => {
    const overview = buildDataSourcesOverview(
      signals({}, { productivity: [{ is_mobile: true, source: 'activitywatch' }] }),
    )

    expect(source(overview, 'activitywatch_android')).toMatchObject({
      detail: 'Mobile data syncing',
      status: 'active',
    })
    expect(source(overview, 'activitywatch_desktop').status).toBe('not_set_up')
  })

  test('the Android app is active on recent Health Connect records', () => {
    expect(
      source(buildDataSourcesOverview(signals({}, { health_connect: true })), 'android_app').status,
    ).toBe('active')
  })

  test('nothing connected leaves only Aurboda active', () => {
    const overview = buildDataSourcesOverview(signals())

    expect(overview.sources.filter((s) => s.status === 'active').map((s) => s.id)).toEqual(['aurboda'])
    expect(source(overview, 'aurboda').detail).toBe('Always available')
    expect(overview.kinds.every((k) => !k.overlap)).toBe(true)
    expect(source(overview, 'calendars').detail).toBe('No calendars added')
  })

  test('calendars count what is configured', () => {
    const overview = buildDataSourcesOverview(
      signals({
        calendars: [
          { name: 'Work', url: 'https://example.org/a.ics' },
          { name: 'Home', url: 'https://example.org/b.ics' },
        ],
        gravl_connection: 'token',
        lastfm_username: 'me',
        strava_connected: true,
      }),
    )

    expect(source(overview, 'calendars')).toMatchObject({
      detail: '2 calendar(s) configured',
      status: 'active',
    })
    expect(source(overview, 'gravl').status).toBe('active')
    expect(source(overview, 'lastfm')).toMatchObject({ detail: 'Connected', status: 'active' })
    expect(source(overview, 'strava').status).toBe('active')
  })

  test('lists the groups in display order', () => {
    expect(buildDataSourcesOverview(signals()).groups.map((g) => g.id)).toEqual([...dataSourceGroupIds])
  })
})

describe('getDataSourcesOverview', () => {
  test('loads the settings and the last 7 and 30 days of activity for the user', async () => {
    const calls: unknown[] = []
    const overview = await getDataSourcesOverview('alice', {
      loadActivity: async (user, since) => {
        calls.push([user, since])
        return { ...noActivity, location_sources: ['owntracks'] }
      },
      loadSettings: async (user) => {
        calls.push(user)
        return { ...noSettings, ...homeAssistant }
      },
      now: () => new Date('2026-11-23T12:00:00Z'),
    })

    expect(kind(overview, 'location').overlap).toBe(true)
    expect(calls).toContainEqual('alice')
    expect(calls).toContainEqual([
      'alice',
      { since30d: new Date('2026-10-24T12:00:00Z'), since7d: new Date('2026-11-16T12:00:00Z') },
    ])
  })
})
