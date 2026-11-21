import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, test } from 'vitest'

import { RESYNC_FALLBACK_ERROR, resyncErrorText } from './resyncError'

const axiosError = (status: number, data: unknown) =>
  new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, {
    config: { headers: new AxiosHeaders() },
    data,
    headers: {},
    status,
    statusText: '',
  })

describe('resyncErrorText', () => {
  test('shows the server’s reason when the answer carries one', () => {
    const error = axiosError(409, {
      error: 'Re-syncing needs the Garmin Connect login',
      points: 0,
      success: false,
    })
    expect(resyncErrorText(error)).toBe('Re-syncing needs the Garmin Connect login')
  })

  test('falls back to the error’s message when the answer has no reason', () => {
    expect(resyncErrorText(axiosError(500, ''))).toBe('Request failed with status code 500')
  })

  test('uses the fallback for a thrown non-error', () => {
    expect(resyncErrorText('boom')).toBe(RESYNC_FALLBACK_ERROR)
  })
})
