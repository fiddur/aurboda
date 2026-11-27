import type { UserSettingsResponse } from '@aurboda/api-spec'

import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { invalidateSourceQueries } from './sourceQueries'

const seeded = () => {
  const queryClient = new QueryClient()
  for (const key of [['userSettings'], ['dataSourcesOverview'], ['ouraSyncStatus']]) {
    queryClient.setQueryData(key, { value: 1 })
  }
  return queryClient
}

const invalidated = (queryClient: QueryClient) =>
  [['userSettings'], ['dataSourcesOverview'], ['ouraSyncStatus']].map(
    (key) => queryClient.getQueryState(key)?.isInvalidated,
  )

describe('invalidateSourceQueries', () => {
  it('marks the settings and the data sources overview stale, and nothing else', async () => {
    const queryClient = seeded()
    await invalidateSourceQueries(queryClient)
    expect(invalidated(queryClient)).toEqual([true, true, false])
  })

  it('stores saved settings as they are and marks only the overview stale', async () => {
    const queryClient = seeded()
    const settings = { lastfm_username: 'someone' } as UserSettingsResponse
    await invalidateSourceQueries(queryClient, settings)
    expect(queryClient.getQueryData(['userSettings'])).toEqual(settings)
    expect(invalidated(queryClient)).toEqual([false, true, false])
  })
})
