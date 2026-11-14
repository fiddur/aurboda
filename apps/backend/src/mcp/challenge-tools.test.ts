import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { ChallengePatch, ChallengeRecord } from '../db/index.ts'
import type { McpServer } from './helpers.ts'

const db = vi.hoisted(() => ({
  deleteChallengeBanner: vi.fn(async () => true),
  getChallengeById: vi.fn<(user: string, id: string) => Promise<ChallengeRecord | null>>(),
  getChallengeBySlug: vi.fn<(user: string, slug: string) => Promise<ChallengeRecord | null>>(),
  updateChallenge:
    vi.fn<
      (
        user: string,
        id: string,
        patch: ChallengePatch,
        options?: { unlessRemoteMember?: boolean },
      ) => Promise<ChallengeRecord | null>
    >(),
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

describe('update_challenge', () => {
  const changedSpec = {
    aggregation: 'sum',
    bucket_size: 'auto',
    pattern: 'distance',
    source_type: 'metric',
    unit: 'km',
  }

  let remoteMember = false

  beforeEach(() => {
    remoteMember = false
    db.getChallengeById.mockReset().mockResolvedValue(challenge)
    db.updateChallenge
      .mockReset()
      .mockImplementation(async (_user, _id, patch, options) =>
        options?.unlessRemoteMember && remoteMember
          ? null
          : {
              ...challenge,
              spec: patch.spec ?? challenge.spec,
              timezone: patch.timezone ?? challenge.timezone,
            },
      )
  })

  test('refuses a spec change once a remote member has joined', async () => {
    remoteMember = true
    const { call } = setup()
    expect(await call('update_challenge', { id: challenge.id, spec: changedSpec })).toContain(
      "The scoring can't change once someone from another instance has joined",
    )
  })

  test('refuses a date or timezone change once a remote member has joined', async () => {
    remoteMember = true
    const { call } = setup()
    for (const change of [
      { start_ts: '2026-10-02T00:00:00.000Z' },
      { end_ts: '2026-11-15T00:00:00.000Z' },
      { timezone: 'Europe/Stockholm' },
    ]) {
      expect(await call('update_challenge', { id: challenge.id, ...change })).toContain(
        "The dates and timezone can't change once someone from another instance has joined",
      )
    }
  })

  test('changes the spec and timezone while no remote member has joined', async () => {
    const { call } = setup()
    const body = JSON.parse(
      await call('update_challenge', { id: challenge.id, spec: changedSpec, timezone: 'Europe/Stockholm' }),
    )
    expect(body.spec.pattern).toBe('distance')
    expect(body.timezone).toBe('Europe/Stockholm')
  })
})

describe('preview_challenge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('reads the challenge behind a link without joining it', async () => {
    db.getChallengeBySlug.mockResolvedValue(challenge)
    const { call } = setup()
    const body = JSON.parse(
      await call('preview_challenge', { challenge_url: 'https://aurboda.test/u/bob/abc' }),
    )
    expect(db.getChallengeBySlug).toHaveBeenCalledWith('bob', 'abc')
    expect(body).toMatchObject({
      host_handle: '@bob@aurboda.test',
      name: 'Push-ups',
      share_url: 'https://aurboda.test/u/bob/abc',
    })
  })

  test('says why a link cannot be previewed', async () => {
    db.getChallengeBySlug.mockResolvedValue(null)
    const { call } = setup()
    expect(await call('preview_challenge', { challenge_url: 'https://aurboda.test/u/bob/abc' })).toContain(
      'Challenge not found',
    )
  })
})
