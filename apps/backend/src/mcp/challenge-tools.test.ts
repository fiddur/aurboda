import { beforeEach, describe, expect, test, vi } from 'vitest'

import type {
  ChallengeParticipationRecord,
  ChallengeParticipationSnapshotPatch,
  ChallengePatch,
  ChallengeRecord,
  ChallengeThreadEntryRecord,
} from '../db/index.ts'
import type { McpServer } from './helpers.ts'

const db = vi.hoisted(() => ({
  countChallengeThreadEntries: vi.fn(async () => 0),
  countVisibleChallengeThreadEntries: vi.fn(async () => 0),
  createReplyPost: vi.fn(),
  deleteChallengeThreadEntry: vi.fn(async () => null),
  deleteFeedPostWithQuotes: vi.fn(),
  getChallengeThreadEntryById: vi.fn(async () => null),
  getFeedPostById: vi.fn(async () => null),
  getProfileAvatarVersion: vi.fn(async () => null),
  getUserSettings: vi.fn(async () => null),
  upsertChallengeThreadEntry: vi.fn(async () => null),
  deleteChallengeBanner: vi.fn(async () => true),
  getChallengeById: vi.fn<(user: string, id: string) => Promise<ChallengeRecord | null>>(),
  getChallengeBySlug: vi.fn<(user: string, slug: string) => Promise<ChallengeRecord | null>>(),
  getChallengeThreadEntryByObjectUri: vi.fn(async () => null),
  getParticipationByUrl: vi.fn(async () => null),
  isMissingDatabase: () => false,
  listChallengeMembers: vi.fn(async () => []),
  listChallengeThreadReplies: vi.fn(async () => []),
  listChallengeThreadTopLevel: vi.fn(async () => []),
  listChallengeParticipations: vi.fn<(user: string) => Promise<ChallengeParticipationRecord[]>>(),
  updateChallengeParticipationSnapshot:
    vi.fn<
      (
        user: string,
        id: string,
        patch: ChallengeParticipationSnapshotPatch,
      ) => Promise<ChallengeParticipationRecord | null>
    >(),
  setChallengeThreadEntryHidden:
    vi.fn<
      (
        user: string,
        challengeId: string,
        id: string,
        hidden: boolean,
      ) => Promise<ChallengeThreadEntryRecord | null>
    >(),
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

const setup = (deps: Parameters<typeof registerChallengeTools>[2] = { webHost: 'https://aurboda.test' }) => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => tools.set(name, handler),
  } as unknown as McpServer
  registerChallengeTools(server, 'alice', deps)
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
    db.updateChallenge.mockReset().mockImplementation(async (_user, _id, patch, options) =>
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

describe('list_joined_challenges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('lists the participations, a challenge on this instance as the host has it now', async () => {
    const joined: ChallengeParticipationRecord = {
      challenge_url: 'https://aurboda.test/u/bob/abc',
      created_at: new Date('2026-10-02T00:00:00Z'),
      data_token: 'tok',
      end_ts: new Date('2026-10-20T00:00:00Z'),
      host_checked_at: null,
      host_identity: 'https://aurboda.test/u/bob',
      id: 'p1',
      name: 'Old name',
      protocol: 'aurboda',
      spec: challenge.spec,
      start_ts: challenge.start_ts,
      status: 'active',
      timezone: 'UTC',
    }
    db.listChallengeParticipations.mockResolvedValue([joined])
    db.getChallengeBySlug.mockResolvedValue(challenge)
    db.updateChallengeParticipationSnapshot.mockImplementation(async (_user, _id, patch) => ({
      ...joined,
      ...patch,
      host_checked_at: null,
    }))
    const { call } = setup()
    const body = JSON.parse(await call('list_joined_challenges'))
    expect(db.updateChallengeParticipationSnapshot).toHaveBeenCalledWith('alice', 'p1', {
      end_ts: challenge.end_ts,
      name: 'Push-ups',
    })
    expect(body).toEqual([
      expect.objectContaining({ end_ts: '2026-11-01T00:00:00.000Z', id: 'p1', name: 'Push-ups' }),
    ])
  })
})

describe('challenge thread tools', () => {
  const entryId = '00000000-0000-4000-8000-0000000000e1'
  const entry: ChallengeThreadEntryRecord = {
    actor_uri: 'https://aurboda.test/api/users/carol',
    audience: 'public',
    avatar_url: null,
    challenge_id: challenge.id,
    content: '<p>Hi</p>',
    created_at: new Date('2026-10-02T00:00:00Z'),
    display_name: 'Carol',
    edited_at: null,
    handle: '@carol@aurboda.test',
    hidden_at: new Date('2026-10-03T00:00:00Z'),
    id: entryId,
    images: [],
    in_reply_to_uri: null,
    kind: 'comment',
    object_uri: 'https://aurboda.test/api/users/carol/feed/1',
    published_at: new Date('2026-10-02T00:00:00Z'),
    root_entry_id: null,
    url: null,
  }

  beforeEach(() => {
    db.getChallengeBySlug.mockReset().mockResolvedValue(challenge)
    db.setChallengeThreadEntryHidden.mockReset().mockResolvedValue(entry)
  })

  test('get_challenge_thread reads the host view of an own challenge', async () => {
    const { call } = setup()
    const body = JSON.parse(
      await call('get_challenge_thread', { challenge_url: 'https://aurboda.test/u/alice/abc' }),
    )
    expect(db.getChallengeBySlug).toHaveBeenCalledWith('alice', 'abc')
    expect(body).toEqual({
      entries: [],
      next_cursor: null,
      total: 0,
      viewer: { audiences: ['public', 'participants'], can_comment: true, role: 'host' },
    })
  })

  test('get_challenge_thread refuses a challenge on another server', async () => {
    const { call } = setup()
    expect(
      await call('get_challenge_thread', { challenge_url: 'https://elsewhere.test/u/bob/abc' }),
    ).toContain('another server')
  })

  test('hide_challenge_comment is for the host, or an admin', async () => {
    const url = 'https://aurboda.test/u/bob/abc'
    expect(await setup().call('hide_challenge_comment', { challenge_url: url, entry_id: entryId })).toContain(
      'Only the host',
    )
    expect(db.setChallengeThreadEntryHidden).not.toHaveBeenCalled()

    const admin = setup({ isAdmin: async () => true, webHost: 'https://aurboda.test' })
    const body = JSON.parse(
      await admin.call('hide_challenge_comment', { challenge_url: url, entry_id: entryId }),
    )
    expect(db.setChallengeThreadEntryHidden).toHaveBeenCalledWith('bob', challenge.id, entryId, true)
    expect(body).toMatchObject({ hidden: true, id: entryId, kind: 'comment' })
  })

  test('unhide_challenge_comment clears the hide on an own challenge', async () => {
    db.setChallengeThreadEntryHidden.mockResolvedValue({ ...entry, hidden_at: null })
    const body = JSON.parse(
      await setup().call('unhide_challenge_comment', {
        challenge_url: 'https://aurboda.test/u/alice/abc',
        entry_id: entryId,
      }),
    )
    expect(db.setChallengeThreadEntryHidden).toHaveBeenCalledWith('alice', challenge.id, entryId, false)
    expect(body.hidden).toBe(false)
  })

  test('the thread tools need a configured web host', async () => {
    const { call } = setup({})
    const params = { audience: 'public', challenge_url: 'https://aurboda.test/u/alice/abc', message: 'Hi' }
    expect(await call('add_challenge_comment', params)).toContain('not configured')
  })
})
