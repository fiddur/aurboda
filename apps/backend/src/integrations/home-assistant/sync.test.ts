import { describe, expect, test } from 'vitest'

import type { Location, SyncState, UserSettings } from '../../db/types.ts'
import type { HomeAssistantClient } from './client.ts'
import type { HomeAssistantState } from './process.ts'

import { activityTrackSources } from '../gps-precedence.ts'
import { HomeAssistantApiError } from './client.ts'
import { type HomeAssistantSyncDeps, homeAssistantConnection, syncHomeAssistantLocations } from './sync.ts'

const NOW = new Date('2026-11-13T12:00:00Z')
const configured: UserSettings = {
  home_assistant_entity_id: 'device_tracker.pixel_8',
  home_assistant_token: 'token',
  home_assistant_url: 'https://ha.example.org',
}

const fix = (
  last_updated: string,
  attributes: Record<string, unknown> = { latitude: 59.3, longitude: 18.1 },
) => ({ attributes, entity_id: 'device_tracker.pixel_8', last_updated, state: 'home' }) as HomeAssistantState

interface Harness {
  deps: HomeAssistantSyncDeps
  historyCalls: { start: Date; end: Date }[]
  inserted: Location[][]
  states: SyncState[]
  softDeletes: unknown[][]
  synced: [string, Date, Date][]
}

const harness = (
  opts: {
    settings?: UserSettings
    syncState?: SyncState | null
    history?: (start: Date) => HomeAssistantState[]
    failOnCall?: number
    insertedPerBatch?: (locations: Location[]) => number
    superseded?: number
  } = {},
): Harness => {
  const h: Omit<Harness, 'deps'> = { historyCalls: [], inserted: [], softDeletes: [], states: [], synced: [] }
  const client: HomeAssistantClient = {
    getHistory: async (_conn, _entity, start, end) => {
      h.historyCalls.push({ end, start })
      if (opts.failOnCall === h.historyCalls.length) {
        throw new HomeAssistantApiError('Home Assistant rejected the access token', 401)
      }
      return opts.history?.(start) ?? []
    },
    getStates: async () => [],
  }
  return {
    ...h,
    deps: {
      auditError: async () => {},
      auditInfo: async () => {},
      client,
      getSettings: async () => opts.settings ?? configured,
      getSyncState: async () => opts.syncState ?? null,
      insertLocations: async (_user, locations) => {
        h.inserted.push(locations)
        return opts.insertedPerBatch ? opts.insertedPerBatch(locations) : locations.length
      },
      now: () => NOW,
      onLocationsSynced: (user, start, end) => void h.synced.push([user, start, end]),
      softDeleteLocationsInTrackedActivities: async (...args) => {
        h.softDeletes.push(args)
        return opts.superseded ?? 0
      },
      upsertSyncState: async (_user, state) => void h.states.push(state),
    },
  }
}

describe('homeAssistantConnection', () => {
  test('needs all three settings', () => {
    expect(homeAssistantConnection(configured)).toEqual({
      baseUrl: 'https://ha.example.org',
      entityId: 'device_tracker.pixel_8',
      token: 'token',
    })
    expect(homeAssistantConnection({ ...configured, home_assistant_token: undefined })).toBeNull()
    expect(homeAssistantConnection({ ...configured, home_assistant_url: undefined })).toBeNull()
    expect(homeAssistantConnection({ ...configured, home_assistant_entity_id: undefined })).toBeNull()
  })
})

describe('syncHomeAssistantLocations', () => {
  test('reports an unconfigured user without touching sync state', async () => {
    const h = harness({ settings: {} })
    expect(await syncHomeAssistantLocations('alice', h.deps)).toEqual({
      error: 'Home Assistant is not configured',
      locations_fetched: 0,
      locations_inserted: 0,
      locations_superseded: 0,
      status: 'error',
    })
    expect(h.states).toEqual([])
    expect(h.historyCalls).toEqual([])
  })

  test('first sync reads the last 10 days in daily slices', async () => {
    const h = harness()
    const result = await syncHomeAssistantLocations('alice', h.deps)
    expect(result.status).toBe('success')
    expect(h.historyCalls).toHaveLength(10)
    expect(h.historyCalls[0].start).toEqual(new Date('2026-11-03T12:00:00Z'))
    expect(h.historyCalls[9].end).toEqual(NOW)
    expect(h.states[0]).toMatchObject({
      status: 'syncing',
      sync_start_date: new Date('2026-11-03T12:00:00Z'),
    })
    expect(h.states.at(-1)).toMatchObject({ last_sync_time: NOW, status: 'idle' })
  })

  test('incremental sync starts 5 minutes before the last sync', async () => {
    const h = harness({
      syncState: {
        data_type: 'locations',
        last_sync_time: new Date('2026-11-13T11:50:00Z'),
        provider: 'home_assistant',
        status: 'idle',
      },
    })
    await syncHomeAssistantLocations('alice', h.deps)
    expect(h.historyCalls).toEqual([{ end: NOW, start: new Date('2026-11-13T11:45:00Z') }])
  })

  test('full resync from a start date ignores the last sync', async () => {
    const h = harness({
      syncState: {
        data_type: 'locations',
        last_sync_time: new Date('2026-11-13T11:50:00Z'),
        provider: 'home_assistant',
        status: 'idle',
      },
    })
    await syncHomeAssistantLocations('alice', h.deps, {
      fullResync: true,
      startDate: new Date('2026-11-12T00:00:00Z'),
    })
    expect(h.historyCalls.map((c) => c.start)).toEqual([
      new Date('2026-11-12T00:00:00Z'),
      new Date('2026-11-13T00:00:00Z'),
    ])
  })

  test('stores only states with coordinates and counts fetched and inserted', async () => {
    const h = harness({
      history: (start) =>
        start.getTime() === new Date('2026-11-12T12:00:00Z').getTime()
          ? [
              fix('2026-11-13T08:00:00+00:00'),
              fix('2026-11-13T09:00:00+00:00'),
              fix('2026-11-13T10:00:00+00:00', {}),
            ]
          : [],
      insertedPerBatch: (locations) => (locations.length > 0 ? 1 : 0),
    })
    const result = await syncHomeAssistantLocations('alice', h.deps)
    expect(result).toEqual({
      locations_fetched: 2,
      locations_inserted: 1,
      locations_superseded: 0,
      status: 'success',
    })
    expect(h.inserted.flat().map((l) => l.source)).toEqual(['home_assistant', 'home_assistant'])
  })

  test('soft-deletes points covered by activity tracks over the window', async () => {
    const h = harness({ superseded: 3 })
    const result = await syncHomeAssistantLocations('alice', h.deps)
    expect(result.locations_superseded).toBe(3)
    expect(h.softDeletes).toEqual([
      ['alice', 'home_assistant', activityTrackSources, new Date('2026-11-03T12:00:00Z'), NOW],
    ])
  })

  test('fires onLocationsSynced with (start, now) only when something new was inserted', async () => {
    const none = harness({ history: () => [fix('2026-11-13T08:00:00+00:00')], insertedPerBatch: () => 0 })
    await syncHomeAssistantLocations('alice', none.deps)
    expect(none.synced).toEqual([])

    const some = harness({ history: () => [fix('2026-11-13T08:00:00+00:00')] })
    await syncHomeAssistantLocations('alice', some.deps)
    expect(some.synced).toEqual([['alice', new Date('2026-11-03T12:00:00Z'), NOW]])
  })

  test('an error records the message, keeps last_sync_time and holds the background poll off', async () => {
    const h = harness({ failOnCall: 2, history: () => [fix('2026-11-13T08:00:00+00:00')] })
    const result = await syncHomeAssistantLocations('alice', h.deps)
    expect(result).toEqual({
      error: 'Home Assistant rejected the access token',
      locations_fetched: 1,
      locations_inserted: 1,
      locations_superseded: 0,
      status: 'error',
    })
    const last = h.states.at(-1)
    expect(last).toMatchObject({
      error_message: 'Home Assistant rejected the access token',
      retry_after: new Date('2026-11-13T12:15:00Z'),
      status: 'error',
    })
    expect(last?.last_sync_time).toBeUndefined()
  })

  test('a run that fails after storing new points still fires onLocationsSynced', async () => {
    const partial = harness({ failOnCall: 2, history: () => [fix('2026-11-13T08:00:00+00:00')] })
    await syncHomeAssistantLocations('alice', partial.deps)
    expect(partial.synced).toEqual([['alice', new Date('2026-11-03T12:00:00Z'), NOW]])

    const nothing = harness({ failOnCall: 1 })
    await syncHomeAssistantLocations('alice', nothing.deps)
    expect(nothing.synced).toEqual([])
  })
})
