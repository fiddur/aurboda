import { describe, expect, test, vi } from 'vitest'

import type { SyncState } from '../db/index.ts'

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
