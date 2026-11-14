import { describe, expect, test, vi } from 'vitest'

import type { SyncState } from '../db/index.ts'

import { withStaleSyncingAsIdle } from './stale-syncing.ts'
import { getVisibleSyncStates, type SyncStateDeps } from './sync-states.ts'

const row = (provider: string): SyncState => ({
  data_type: 'sleep',
  error_message: '91 day(s) had fetch errors',
  provider,
  status: 'error',
})

const fakeDeps = ({ garmin = false, oura = false } = {}) =>
  ({
    getAllSyncStates: vi.fn(async (_user: string, provider: string) => [row(provider)]),
    hasGarminConnection: vi.fn(async () => garmin),
    hasOuraToken: vi.fn(async () => oura),
    now: () => new Date('2026-11-14T12:00:00Z'),
  }) satisfies SyncStateDeps

describe('getVisibleSyncStates', () => {
  test('hides garmin rows when the user has no garmin connection', async () => {
    const deps = fakeDeps()
    expect(await getVisibleSyncStates('alice', 'garmin', deps)).toEqual([])
    expect(deps.hasGarminConnection).toHaveBeenCalledWith('alice')
    expect(deps.getAllSyncStates).not.toHaveBeenCalled()
  })

  test('returns garmin rows when the user has a garmin connection', async () => {
    const deps = fakeDeps({ garmin: true })
    expect(await getVisibleSyncStates('alice', 'garmin', deps)).toEqual([row('garmin')])
    expect(deps.getAllSyncStates).toHaveBeenCalledWith('alice', 'garmin')
  })

  test('hides oura rows when the user has no oura token', async () => {
    const deps = fakeDeps()
    expect(await getVisibleSyncStates('alice', 'oura', deps)).toEqual([])
    expect(deps.hasOuraToken).toHaveBeenCalledWith('alice')
    expect(deps.getAllSyncStates).not.toHaveBeenCalled()
  })

  test('returns oura rows when the user has an oura token', async () => {
    const deps = fakeDeps({ oura: true })
    expect(await getVisibleSyncStates('alice', 'oura', deps)).toEqual([row('oura')])
    expect(deps.getAllSyncStates).toHaveBeenCalledWith('alice', 'oura')
  })

  test('returns other providers rows without checking a connection', async () => {
    const deps = fakeDeps()
    expect(await getVisibleSyncStates('alice', 'lastfm', deps)).toEqual([row('lastfm')])
    expect(deps.hasGarminConnection).not.toHaveBeenCalled()
    expect(deps.hasOuraToken).not.toHaveBeenCalled()
  })
})

describe('a syncing row a restart left behind', () => {
  const now = new Date('2026-11-14T12:00:00Z')
  const syncing = (provider: string, minutesAgo: number): SyncState => ({
    data_type: 'locations',
    provider,
    status: 'syncing',
    updated_at: new Date(now.getTime() - minutesAgo * 60_000),
  })
  const depsWith = (rows: SyncState[]) =>
    ({
      getAllSyncStates: vi.fn(async () => rows),
      hasGarminConnection: vi.fn(async () => true),
      hasOuraToken: vi.fn(async () => true),
      now: () => now,
    }) satisfies SyncStateDeps

  test('reads as idle once it is older than 15 minutes', async () => {
    const states = await getVisibleSyncStates(
      'alice',
      'home_assistant',
      depsWith([syncing('home_assistant', 16)]),
    )
    expect(states.map((s) => s.status)).toEqual(['idle'])
  })

  test('stays syncing while a pull may still be running', async () => {
    const states = await getVisibleSyncStates('alice', 'lastfm', depsWith([syncing('lastfm', 14)]))
    expect(states.map((s) => s.status)).toEqual(['syncing'])
  })

  test('stays syncing for strava, whose queued sync runs for hours', async () => {
    const states = await getVisibleSyncStates('alice', 'strava', depsWith([syncing('strava', 120)]))
    expect(states.map((s) => s.status)).toEqual(['syncing'])
  })

  test("stays syncing for garmin however old, so the sync router's already_syncing guard still holds", async () => {
    const states = await getVisibleSyncStates('alice', 'garmin', depsWith([syncing('garmin', 24 * 60)]))
    expect(states.map((s) => s.status)).toEqual(['syncing'])
  })

  test('leaves other statuses alone', () => {
    const errored: SyncState = { ...syncing('oura', 60), status: 'error' }
    expect(withStaleSyncingAsIdle([errored], now)).toEqual([errored])
  })
})
