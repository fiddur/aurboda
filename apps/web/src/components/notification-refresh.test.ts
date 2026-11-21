import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { checkInKeys } from '../pages/CheckIns/queries'
import { refreshAfterNotificationChange } from './notification-refresh'

describe('refreshAfterNotificationChange', () => {
  it('marks the notifications and every check-in query stale, and nothing else', async () => {
    const queryClient = new QueryClient()
    const keys = [
      ['notifications', 'latest'],
      checkInKeys.due,
      checkInKeys.recent,
      checkInKeys.adherence('form-1'),
      checkInKeys.history('form-1'),
      ['dashboard'],
    ]
    for (const key of keys) queryClient.setQueryData(key, { value: 1 })
    await refreshAfterNotificationChange(queryClient)
    expect(keys.map((key) => queryClient.getQueryState(key)?.isInvalidated)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ])
  })
})
