import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { ChallengeRecord } from '../db/index.ts'
import type { McpServer } from './helpers.ts'

const db = vi.hoisted(() => ({
  deleteChallengeBanner: vi.fn(async () => true),
  getChallengeById: vi.fn<(user: string, id: string) => Promise<ChallengeRecord | null>>(),
}))

vi.mock('../db/index.ts', () => db)

const { registerChallengeTools } = await import('./challenge-tools.ts')

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

const challenge: ChallengeRecord = {
  announce_winner: false,
  banner_updated_at: null,
  created_at: new Date('2026-10-01T00:00:00Z'),
  end_ts: new Date('2026-11-01T00:00:00Z'),
  id: '00000000-0000-4000-8000-000000000001',
  is_public: true,
  join_token: 'jt',
  name: 'Push-ups',
  result_published_at: null,
  slug: 'abc',
  spec: {
    activity_type_id: null,
    aggregation: 'sum',
    bucket_size: 'auto',
    filter_field: null,
    filter_value: null,
    measure: null,
    pattern: 'steps',
    source_type: 'metric',
    unit: 'steps',
  },
  start_ts: new Date('2026-10-01T00:00:00Z'),
  timezone: 'UTC',
  updated_at: new Date('2026-10-01T00:00:00Z'),
}

const setup = () => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => tools.set(name, handler),
  } as unknown as McpServer
  registerChallengeTools(server, 'alice', { webHost: 'https://aurboda.test' })
  const call = async (name: string, params: Record<string, unknown> = {}) =>
    (await tools.get(name)!(params)).content[0]!.text
  return { call }
}

describe('remove_challenge_banner', () => {
  beforeEach(() => {
    db.deleteChallengeBanner.mockClear()
    db.getChallengeById.mockReset()
  })

  test('deletes the banner and returns the re-read challenge', async () => {
    db.getChallengeById.mockResolvedValue(challenge)
    const { call } = setup()
    const body = JSON.parse(await call('remove_challenge_banner', { id: challenge.id }))
    expect(db.deleteChallengeBanner).toHaveBeenCalledWith('alice', challenge.id)
    expect(body.id).toBe(challenge.id)
    expect(body.banner_url).toBeNull()
  })

  test('errors without deleting when the challenge is not found', async () => {
    db.getChallengeById.mockResolvedValue(null)
    const { call } = setup()
    expect(await call('remove_challenge_banner', { id: challenge.id })).toContain('Challenge not found')
    expect(db.deleteChallengeBanner).not.toHaveBeenCalled()
  })
})
