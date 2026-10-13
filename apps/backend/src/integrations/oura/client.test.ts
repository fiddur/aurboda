import axios from 'axios'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { deleteOAuthToken, getOAuthToken } from '../../db/index.ts'
import { ouraClient } from './client.ts'

vi.mock('axios')
vi.mock('../../db/index.ts', () => ({
  deleteOAuthToken: vi.fn(),
  getOAuthToken: vi.fn(),
  initializeSchema: vi.fn(),
  schemaInitialized: vi.fn(),
  upsertOAuthToken: vi.fn(),
}))

const mockedAxios = vi.mocked(axios)

const client = ouraClient(
  async () => ({ clientId: 'client-id', clientSecret: 'client-secret' }),
  'https://example.com/api',
)

describe('ouraClient.disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockedAxios.post = vi.fn().mockResolvedValue({ data: {} })
    vi.mocked(deleteOAuthToken).mockResolvedValue(true)
  })

  test('revokes the access token at Oura and deletes the stored grant', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue({ access_token: 'live-token', provider: 'oura' })

    await client.disconnect('alice')

    expect(mockedAxios.post).toHaveBeenCalledWith('https://api.ouraring.com/oauth/revoke', undefined, {
      params: { access_token: 'live-token' },
    })
    expect(deleteOAuthToken).toHaveBeenCalledWith('alice', 'oura')
  })

  test('still deletes the stored grant when the revoke fails', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue({ access_token: 'dead-token', provider: 'oura' })
    mockedAxios.post = vi.fn().mockRejectedValue(new Error('Request failed with status code 403'))

    await expect(client.disconnect('alice')).resolves.toBeUndefined()

    expect(deleteOAuthToken).toHaveBeenCalledWith('alice', 'oura')
    expect(console.warn).toHaveBeenCalledWith(expect.not.stringContaining('dead-token'), expect.anything())
  })

  test('does nothing when the user has no Oura grant', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue(null)

    await expect(client.disconnect('alice')).resolves.toBeUndefined()

    expect(mockedAxios.post).not.toHaveBeenCalled()
    expect(deleteOAuthToken).not.toHaveBeenCalled()
  })
})
