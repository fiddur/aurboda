import { MAX_FEED_IMAGE_BYTES, MAX_FEED_IMAGES_PER_ACCOUNT } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'

import type { FeedImageRecord } from '../db/index.ts'
import type { McpServer } from './helpers.ts'

import { type FeedImageToolsDeps, registerFeedImageTools } from './feed-image-tools.ts'

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: { text: string }[] }>

const API = 'https://aurboda.test/api'

const record: FeedImageRecord = {
  byte_size: 1234,
  content_type: 'image/webp',
  created_at: new Date('2026-11-01T08:00:00Z'),
  height: 600,
  id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
  width: 800,
}

const serialized = {
  byte_size: 1234,
  created_at: '2026-11-01T08:00:00.000Z',
  height: 600,
  id: record.id,
  url: `${API}/public/alice/images/${record.id}.webp`,
  width: 800,
}

const setup = (overrides: FeedImageToolsDeps = {}) => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  const deps = {
    addFeedImage: vi.fn(async () => ({ image: record, ok: true as const })),
    apiBaseUrl: API,
    deleteFeedImage: vi.fn(async () => true),
    listFeedImages: vi.fn(async () => [record]),
    ...overrides,
  }
  registerFeedImageTools(server, 'alice', deps)
  const call = async (name: string, params: Record<string, unknown> = {}) =>
    (await tools.get(name)!(params)).content[0].text
  return { call, deps }
}

describe('add_feed_image', () => {
  test('stores the decoded picture and answers it with its URL', async () => {
    const { call, deps } = setup()
    const text = await call('add_feed_image', { data_base64: Buffer.from('png-bytes').toString('base64') })
    expect(JSON.parse(text)).toEqual(serialized)
    expect(deps.addFeedImage).toHaveBeenCalledWith('alice', Buffer.from('png-bytes'))
  })

  test('refuses a picture over the size limit without storing it', async () => {
    const { call, deps } = setup()
    const text = await call('add_feed_image', {
      data_base64: Buffer.alloc(MAX_FEED_IMAGE_BYTES + 1).toString('base64'),
    })
    expect(text).toBe('That picture is too large to send.')
    expect(deps.addFeedImage).not.toHaveBeenCalled()
  })

  test('answers the same messages as REST when refused', async () => {
    const unsupported = setup({
      addFeedImage: vi.fn(async () => ({ ok: false as const, reason: 'unsupported' as const })),
    })
    expect(await unsupported.call('add_feed_image', { data_base64: 'PHN2Zy8+' })).toBe(
      'That is not a picture Aurboda can use. PNG, JPEG, WebP or GIF works.',
    )
    const full = setup({
      addFeedImage: vi.fn(async () => ({ ok: false as const, reason: 'limit' as const })),
    })
    expect(await full.call('add_feed_image', { data_base64: 'cG5n' })).toBe(
      `You have stored as many pictures as one account may hold (${MAX_FEED_IMAGES_PER_ACCOUNT}). Delete some first.`,
    )
  })
})

describe('list_feed_images', () => {
  test('lists the pictures with the cap', async () => {
    const { call } = setup()
    expect(JSON.parse(await call('list_feed_images'))).toEqual({
      images: [serialized],
      limit: MAX_FEED_IMAGES_PER_ACCOUNT,
    })
  })
})

describe('delete_feed_image', () => {
  test('deletes the picture', async () => {
    const { call, deps } = setup()
    expect(JSON.parse(await call('delete_feed_image', { id: record.id }))).toEqual({ success: true })
    expect(deps.deleteFeedImage).toHaveBeenCalledWith('alice', record.id)
  })

  test('reports a missing picture', async () => {
    const { call } = setup({ deleteFeedImage: vi.fn(async () => false) })
    expect(await call('delete_feed_image', { id: record.id })).toBe('Picture not found')
  })
})
