import { describe, expect, test, vi } from 'vitest'

import type { MintUploadUrlDeps } from '../services/upload-urls.ts'
import type { McpServer } from './helpers.ts'

import { createTokenBucketLimiter, RATE_LIMITS } from '../services/rate-limit.ts'
import { registerUploadUrlTools, type UploadUrlToolsDeps } from './upload-url-tools.ts'

type ToolResult = { content: { text: string }[]; isError?: boolean }
type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>

const API = 'https://aurboda.test/api'
const TOKEN = Buffer.alloc(32, 7).toString('base64url')

const mintDeps = (): MintUploadUrlDeps => ({
  apiBaseUrl: API,
  challengeExists: vi.fn(async () => true),
  insert: vi.fn(async () => {}),
  noteEntryFailure: vi.fn(async () => null),
  now: () => new Date('2026-11-23T10:00:00Z'),
  randomBytes: () => Buffer.alloc(32, 7),
})

const setup = (overrides: UploadUrlToolsDeps = {}) => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  const mint = mintDeps()
  registerUploadUrlTools(server, 'alice', { apiBaseUrl: API, mint, ...overrides })
  const call = (params: Record<string, unknown>) => tools.get('create_upload_url')!(params)
  return { call, mint }
}

describe('create_upload_url', () => {
  test('answers the upload URL', async () => {
    const { call, mint } = setup()
    const result = await call({ target: 'feed_image' })
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({
      data: {
        expires_at: '2026-11-23T10:15:00.000Z',
        max_bytes: 10 * 1024 * 1024,
        method: 'PUT',
        target: 'feed_image',
        upload_url: `${API}/uploads/alice/${TOKEN}`,
      },
      success: true,
    })
    expect(mint.insert).toHaveBeenCalledTimes(1)
  })

  test('answers the mint refusal as an error', async () => {
    const { call, mint } = setup()
    const result = await call({ target: 'challenge_banner' })
    expect(result).toEqual({
      content: [{ text: 'challenge_banner needs a challenge_id', type: 'text' }],
      isError: true,
    })
    expect(mint.insert).not.toHaveBeenCalled()
  })

  test('takes the upload budget, and refuses once it is used up', async () => {
    const uploadLimiter = createTokenBucketLimiter(RATE_LIMITS.uploads, () => 0)
    const { call, mint } = setup({ uploadLimiter })
    for (let i = 0; i < RATE_LIMITS.uploads.capacity; i++) {
      expect((await call({ target: 'profile_avatar' })).isError).toBeUndefined()
    }
    const refused = await call({ target: 'profile_avatar' })
    expect(refused.isError).toBe(true)
    expect(refused.content[0].text).toMatch(/^Too many requests/)
    expect(mint.insert).toHaveBeenCalledTimes(RATE_LIMITS.uploads.capacity)
  })

  test('is unavailable without an API base URL', async () => {
    const { call } = setup({ apiBaseUrl: undefined })
    expect((await call({ target: 'feed_image' })).content[0].text).toBe('Upload URLs are not available')
  })
})
