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
    mockedAxios.post = vi
      .fn()
      .mockRejectedValue(new Error('403 from https://api.ouraring.com/oauth/revoke?access_token=dead-token'))

    await expect(client.disconnect('alice')).resolves.toBeUndefined()

    expect(deleteOAuthToken).toHaveBeenCalledWith('alice', 'oura')
    expect(console.warn).toHaveBeenCalledWith(
      expect.not.stringContaining('dead-token'),
      expect.not.stringContaining('dead-token'),
    )
  })

  test('does nothing when the user has no Oura grant', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue(null)

    await expect(client.disconnect('alice')).resolves.toBeUndefined()

    expect(mockedAxios.post).not.toHaveBeenCalled()
    expect(deleteOAuthToken).not.toHaveBeenCalled()
  })
})

describe('ouraClient.getTags', () => {
  const ouraTag = (overrides: {
    custom_name?: string | null
    id: string
    tag_type_code?: string | null
  }) => ({
    comment: null,
    custom_name: null,
    end_time: '2026-01-02T10:00:00+00:00',
    start_time: '2026-01-02T09:00:00+00:00',
    tag_type_code: null,
    ...overrides,
  })

  const getTags = async (tags: ReturnType<typeof ouraTag>[], mappings?: Record<string, string>) => {
    mockedAxios.get = vi.fn().mockResolvedValue({ data: { data: tags } })
    return client.getTags(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-03T00:00:00Z'),
      'token',
      mappings,
    )
  }

  test('names the tag by mapping, custom name, code or unknown, and marks only a bare code', async () => {
    const tags = await getTags(
      [
        ouraTag({ id: 'mapped', tag_type_code: 'tag_generic_beer' }),
        ouraTag({ custom_name: 'Late dinner', id: 'custom', tag_type_code: 'tag_sleep_latemeal' }),
        ouraTag({ id: 'bare', tag_type_code: 'tag_sleep_sauna' }),
        ouraTag({ id: 'neither' }),
      ],
      { tag_generic_beer: 'Beer' },
    )

    const byId = Object.fromEntries(tags.map((tag) => [tag.external_id, tag]))
    expect(byId.mapped).toMatchObject({ tag: 'Beer', tag_key: 'tag_generic_beer' })
    expect(byId.mapped).not.toHaveProperty('tag_from_code')
    expect(byId.custom).toMatchObject({ tag: 'Late dinner', tag_key: 'tag_sleep_latemeal' })
    expect(byId.custom).not.toHaveProperty('tag_from_code')
    expect(byId.bare).toMatchObject({
      tag: 'tag_sleep_sauna',
      tag_from_code: true,
      tag_key: 'tag_sleep_sauna',
    })
    expect(byId.neither).toMatchObject({ tag: 'unknown' })
    expect(byId.neither).not.toHaveProperty('tag_from_code')
  })
})
