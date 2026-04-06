/**
 * Last.fm sync module tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LastFmTagRule, ScrobbleRecord } from './db/index.ts'
import type { Scrobble } from './lastfm.ts'

import {
  applyRuleRetroactively,
  applyTagRules,
  cleanupRuleTags,
  matchesRule,
  retagAllScrobbles,
  scrobbleRecordToScrobble,
  syncLastFmData,
} from './lastfm-sync.ts'

// Mock the db module
vi.mock('./db', () => ({
  findMergeableTag: vi.fn(),
  getAllScrobbles: vi.fn(),
  getLastFmTagRules: vi.fn(),
  getSyncState: vi.fn(),
  hardDeleteTagsByExternalIdPrefix: vi.fn(),
  hardDeleteTagsBySource: vi.fn(),
  insertRawRecord: vi.fn(),
  insertTag: vi.fn(),
  updateTagEndTime: vi.fn(),
  upsertSyncState: vi.fn(),
}))

// Mock the lastfm module
vi.mock('./lastfm', () => ({
  lastfmClient: vi.fn(() => ({
    getRecentTracks: vi.fn(),
  })),
}))

import {
  findMergeableTag,
  getAllScrobbles,
  getLastFmTagRules,
  getSyncState,
  hardDeleteTagsByExternalIdPrefix,
  hardDeleteTagsBySource,
  insertRawRecord,
  insertTag,
  updateTagEndTime,
  upsertSyncState,
} from './db/index.ts'
import { lastfmClient } from './lastfm.ts'

describe('matchesRule', () => {
  const baseScrobble: Scrobble = {
    album: 'Test Album',
    artist: 'Test Artist',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    track: 'Test Track',
  }

  const baseRule: LastFmTagRule = {
    created_at: new Date(),
    id: 'rule-1',
    match_mode: 'exact',
    match_type: 'track',
    rule_name: 'Test Rule',
    tag_name: 'TestTag',
  }

  describe('track match type', () => {
    it('matches exact track name (case insensitive)', () => {
      const rule = { ...baseRule, match_type: 'track' as const, track_name: 'Test Track' }
      expect(matchesRule(baseScrobble, rule)).toBe(true)

      const ruleUpperCase = { ...baseRule, match_type: 'track' as const, track_name: 'TEST TRACK' }
      expect(matchesRule(baseScrobble, ruleUpperCase)).toBe(true)
    })

    it('does not match different track name with exact mode', () => {
      const rule = { ...baseRule, match_type: 'track' as const, track_name: 'Different Track' }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('matches substring with contains mode', () => {
      const rule = {
        ...baseRule,
        match_mode: 'contains' as const,
        match_type: 'track' as const,
        track_name: 'Test',
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('returns false when track_name is missing', () => {
      const rule = { ...baseRule, match_type: 'track' as const }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })
  })

  describe('artist match type', () => {
    it('matches exact artist name (case insensitive)', () => {
      const rule = { ...baseRule, artist_name: 'Test Artist', match_type: 'artist' as const }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('does not match different artist name with exact mode', () => {
      const rule = { ...baseRule, artist_name: 'Different Artist', match_type: 'artist' as const }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('matches substring with contains mode', () => {
      const rule = {
        ...baseRule,
        artist_name: 'Test',
        match_mode: 'contains' as const,
        match_type: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('returns false when artist_name is missing', () => {
      const rule = { ...baseRule, match_type: 'artist' as const }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })
  })

  describe('track_artist match type', () => {
    it('matches when both track and artist match', () => {
      const rule = {
        ...baseRule,
        artist_name: 'Test Artist',
        match_type: 'track_artist' as const,
        track_name: 'Test Track',
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('does not match when only track matches', () => {
      const rule = {
        ...baseRule,
        artist_name: 'Different Artist',
        match_type: 'track_artist' as const,
        track_name: 'Test Track',
      }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('does not match when only artist matches', () => {
      const rule = {
        ...baseRule,
        artist_name: 'Test Artist',
        match_type: 'track_artist' as const,
        track_name: 'Different Track',
      }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('returns false when track_name or artist_name is missing', () => {
      const ruleNoTrack = { ...baseRule, artist_name: 'Test Artist', match_type: 'track_artist' as const }
      const ruleNoArtist = { ...baseRule, match_type: 'track_artist' as const, track_name: 'Test Track' }

      expect(matchesRule(baseScrobble, ruleNoTrack)).toBe(false)
      expect(matchesRule(baseScrobble, ruleNoArtist)).toBe(false)
    })
  })

  describe('artist_names array matching', () => {
    it('matches when scrobble artist is in artist_names array (artist type)', () => {
      const rule = {
        ...baseRule,
        artist_names: ['Artist A', 'Test Artist', 'Artist B'],
        match_type: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('does not match when scrobble artist is not in artist_names array', () => {
      const rule = {
        ...baseRule,
        artist_names: ['Artist A', 'Artist B', 'Artist C'],
        match_type: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('artist_names takes precedence over artist_name', () => {
      const rule = {
        ...baseRule,
        artist_name: 'Test Artist', // would match
        artist_names: ['Different Artist'], // does not match, takes precedence
        match_type: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('falls back to artist_name when artist_names is empty', () => {
      const rule = {
        ...baseRule,
        artist_name: 'Test Artist',
        artist_names: [] as string[],
        match_type: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('matches artist_names with contains mode', () => {
      const rule = {
        ...baseRule,
        artist_names: ['Artist A', 'Test'],
        match_mode: 'contains' as const,
        match_type: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('matches artist_names in track_artist type', () => {
      const rule = {
        ...baseRule,
        artist_names: ['Test Artist', 'Other Artist'],
        match_type: 'track_artist' as const,
        track_name: 'Test Track',
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })
  })
})

describe('applyTagRules', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('creates tags for matching scrobbles', async () => {
    const scrobbles: Scrobble[] = [
      { artist: 'Vocal Artist', timestamp: new Date('2024-01-01T10:00:00Z'), track: 'Warmup Song' },
      { artist: 'Other Artist', timestamp: new Date('2024-01-01T11:00:00Z'), track: 'Other Song' },
    ]

    const rules: LastFmTagRule[] = [
      {
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'track',
        rule_name: 'Vocal Exercises',
        tag_name: 'VocalExercises',
        track_name: 'Warmup Song',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    expect(tagsCreated).toBe(1)
    expect(insertTag).toHaveBeenCalledTimes(1)
    expect(insertTag).toHaveBeenCalledWith('testuser', {
      external_id: expect.stringMatching(/^lastfm-auto-rule-1-/),
      source: 'lastfm-auto',
      start_time: new Date('2024-01-01T10:00:00Z'),
      tag: 'VocalExercises',
    })
  })

  it('returns 0 when no rules', async () => {
    const scrobbles: Scrobble[] = [
      { artist: 'Test Artist', timestamp: new Date('2024-01-01T10:00:00Z'), track: 'Test Track' },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, [])

    expect(tagsCreated).toBe(0)
    expect(insertTag).not.toHaveBeenCalled()
  })

  it('deduplicates tags with same name and timestamp', async () => {
    const timestamp = new Date('2024-01-01T10:00:00Z')
    const scrobbles: Scrobble[] = [{ artist: 'Test Artist', timestamp, track: 'Test Track' }]

    const rules: LastFmTagRule[] = [
      {
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'track',
        rule_name: 'Rule 1',
        tag_name: 'SameTag',
        track_name: 'Test Track',
      },
      {
        artist_name: 'Test Artist',
        created_at: new Date(),
        id: 'rule-2',
        match_mode: 'exact',
        match_type: 'artist',
        rule_name: 'Rule 2',
        tag_name: 'SameTag',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    // Both rules match, but same tag + timestamp should only create one tag
    expect(tagsCreated).toBe(1)
    expect(insertTag).toHaveBeenCalledTimes(1)
  })

  it('creates span tags for session rules', async () => {
    vi.mocked(findMergeableTag).mockResolvedValue(undefined)

    const scrobbles: Scrobble[] = [
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:00:00Z'), track: 'Song 1' },
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:04:00Z'), track: 'Song 2' },
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:08:00Z'), track: 'Song 3' },
    ]

    const rules: LastFmTagRule[] = [
      {
        artist_name: 'Warmup Artist',
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'artist',
        merge_gap_seconds: 600,
        rule_name: 'Vocal Exercises',
        tag_name: 'VocalExercise',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    expect(tagsCreated).toBe(1)
    expect(insertTag).toHaveBeenCalledTimes(1)
    // End time is the last scrobble (10:08) + merge_gap_seconds (10min) = 10:18.
    expect(insertTag).toHaveBeenCalledWith('testuser', {
      end_time: new Date('2024-01-01T10:18:00Z'),
      external_id: expect.stringMatching(/^lastfm-session-rule-1-/),
      source: 'lastfm-auto',
      start_time: new Date('2024-01-01T10:00:00Z'),
      tag: 'VocalExercise',
    })
  })

  it('creates multiple span tags for separate sessions', async () => {
    vi.mocked(findMergeableTag).mockResolvedValue(undefined)

    const scrobbles: Scrobble[] = [
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:00:00Z'), track: 'Song 1' },
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:04:00Z'), track: 'Song 2' },
      // Gap > 600s
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T11:00:00Z'), track: 'Song 3' },
    ]

    const rules: LastFmTagRule[] = [
      {
        artist_name: 'Warmup Artist',
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'artist',
        merge_gap_seconds: 600,
        rule_name: 'Vocal Exercises',
        tag_name: 'VocalExercise',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    expect(tagsCreated).toBe(2)
    expect(insertTag).toHaveBeenCalledTimes(2)
  })

  it('creates separate session tags when scrobbles arrive in reverse chronological order', async () => {
    vi.mocked(findMergeableTag).mockResolvedValue(undefined)

    // Last.fm API returns scrobbles in reverse chronological order (newest first)
    const scrobbles: Scrobble[] = [
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-17T10:08:00Z'), track: 'Song 3' },
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-17T10:04:00Z'), track: 'Song 2' },
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-17T10:00:00Z'), track: 'Song 1' },
      // Different day - gap is much larger than merge gap
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-09T11:04:00Z'), track: 'Song 2' },
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-09T11:00:00Z'), track: 'Song 1' },
    ]

    const rules: LastFmTagRule[] = [
      {
        artist_name: 'Warmup Artist',
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'artist',
        merge_gap_seconds: 600,
        rule_name: 'Vocal Exercises',
        tag_name: 'VocalExercise',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    expect(tagsCreated).toBe(2)
    expect(insertTag).toHaveBeenCalledTimes(2)

    // First session: Jan 9 (11:00–11:04) + merge_gap 10min = 11:14.
    expect(insertTag).toHaveBeenCalledWith('testuser', {
      end_time: new Date('2024-01-09T11:14:00Z'),
      external_id: expect.stringContaining('rule-1'),
      source: 'lastfm-auto',
      start_time: new Date('2024-01-09T11:00:00Z'),
      tag: 'VocalExercise',
    })

    // Second session: Jan 17 (10:00–10:08) + merge_gap 10min = 10:18.
    expect(insertTag).toHaveBeenCalledWith('testuser', {
      end_time: new Date('2024-01-17T10:18:00Z'),
      external_id: expect.stringContaining('rule-1'),
      source: 'lastfm-auto',
      start_time: new Date('2024-01-17T10:00:00Z'),
      tag: 'VocalExercise',
    })
  })

  it('extends existing tag via findMergeableTag for cross-sync merging', async () => {
    const existingTag = {
      end_time: new Date('2024-01-01T09:58:00Z'),
      external_id: 'lastfm-session-rule-1-existing',
      id: 'tag-id-1',
      source: 'lastfm-auto' as const,
      start_time: new Date('2024-01-01T09:50:00Z'),
      tag: 'VocalExercise',
    }
    vi.mocked(findMergeableTag).mockResolvedValueOnce(existingTag)

    const scrobbles: Scrobble[] = [
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:02:00Z'), track: 'Song 1' },
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:06:00Z'), track: 'Song 2' },
    ]

    const rules: LastFmTagRule[] = [
      {
        artist_name: 'Warmup Artist',
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'artist',
        merge_gap_seconds: 600,
        rule_name: 'Vocal Exercises',
        tag_name: 'VocalExercise',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    // End extended by merge_gap_seconds: 10:06 + 10min = 10:16.
    expect(tagsCreated).toBe(1)
    expect(updateTagEndTime).toHaveBeenCalledWith(
      'testuser',
      'lastfm-session-rule-1-existing',
      new Date('2024-01-01T10:16:00Z'),
    )
    expect(insertTag).not.toHaveBeenCalled()
  })

  it('extends single-scrobble session by merge_gap_seconds', async () => {
    vi.mocked(findMergeableTag).mockResolvedValue(undefined)

    // Single matching scrobble — merge_gap_seconds used as duration estimate
    const scrobbles: Scrobble[] = [
      { artist: 'Holosync', timestamp: new Date('2024-01-01T14:36:00Z'), track: 'Dive' },
    ]

    const rules: LastFmTagRule[] = [
      {
        artist_name: 'Holosync',
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'artist',
        merge_gap_seconds: 1860, // 31 minutes
        rule_name: 'Holosync',
        tag_name: 'Holosync',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    expect(tagsCreated).toBe(1)
    expect(insertTag).toHaveBeenCalledWith('testuser', {
      // End = 14:36 + 31min = 15:07
      end_time: new Date('2024-01-01T15:07:00Z'),
      external_id: expect.stringMatching(/^lastfm-session-rule-1-/),
      source: 'lastfm-auto',
      start_time: new Date('2024-01-01T14:36:00Z'),
      tag: 'Holosync',
    })
  })

  it('handles mix of point-in-time and session rules', async () => {
    vi.mocked(findMergeableTag).mockResolvedValue(undefined)

    const scrobbles: Scrobble[] = [
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:00:00Z'), track: 'Song 1' },
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:04:00Z'), track: 'Song 2' },
    ]

    const rules: LastFmTagRule[] = [
      {
        artist_name: 'Warmup Artist',
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'artist',
        merge_gap_seconds: 600,
        rule_name: 'Session Rule',
        tag_name: 'SessionTag',
      },
      {
        artist_name: 'Warmup Artist',
        created_at: new Date(),
        id: 'rule-2',
        match_mode: 'exact',
        match_type: 'artist',
        rule_name: 'Point Rule',
        tag_name: 'PointTag',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    // 1 session tag + 2 point-in-time tags
    expect(tagsCreated).toBe(3)
  })

  it('creates multiple tags for different rules with different tag names', async () => {
    const timestamp = new Date('2024-01-01T10:00:00Z')
    const scrobbles: Scrobble[] = [{ artist: 'Test Artist', timestamp, track: 'Test Track' }]

    const rules: LastFmTagRule[] = [
      {
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'track',
        rule_name: 'Rule 1',
        tag_name: 'Tag1',
        track_name: 'Test Track',
      },
      {
        artist_name: 'Test Artist',
        created_at: new Date(),
        id: 'rule-2',
        match_mode: 'exact',
        match_type: 'artist',
        rule_name: 'Rule 2',
        tag_name: 'Tag2',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    expect(tagsCreated).toBe(2)
    expect(insertTag).toHaveBeenCalledTimes(2)
  })
})

describe('syncLastFmData', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('syncs scrobbles and applies tag rules', async () => {
    const mockScrobbles: Scrobble[] = [
      { artist: 'Test Artist', timestamp: new Date('2024-01-01T10:00:00Z'), track: 'Test Track' },
    ]

    const mockRules: LastFmTagRule[] = [
      {
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'track',
        rule_name: 'Test Rule',
        tag_name: 'TestTag',
        track_name: 'Test Track',
      },
    ]

    vi.mocked(getSyncState).mockResolvedValue(null)
    vi.mocked(getLastFmTagRules).mockResolvedValue(mockRules)

    const mockClient = {
      getRecentTracks: vi.fn().mockResolvedValue(mockScrobbles),
    }
    vi.mocked(lastfmClient).mockReturnValue(mockClient as unknown as ReturnType<typeof lastfmClient>)

    const result = await syncLastFmData('testuser', 'api-key', 'lastfm-username')

    expect(result.status).toBe('success')
    expect(result.scrobbles_processed).toBe(1)
    expect(result.tags_created).toBe(1)

    expect(insertRawRecord).toHaveBeenCalledTimes(1)
    expect(insertTag).toHaveBeenCalledTimes(1)
    expect(upsertSyncState).toHaveBeenCalledWith(
      'testuser',
      expect.objectContaining({
        data_type: 'scrobbles',
        provider: 'lastfm',
        status: 'idle',
      }),
    )
  })

  it('handles API errors', async () => {
    vi.mocked(getSyncState).mockResolvedValue(null)

    const mockClient = {
      getRecentTracks: vi.fn().mockRejectedValue(new Error('API Error')),
    }
    vi.mocked(lastfmClient).mockReturnValue(mockClient as unknown as ReturnType<typeof lastfmClient>)

    const result = await syncLastFmData('testuser', 'api-key', 'lastfm-username')

    expect(result.status).toBe('error')
    expect(result.error).toBe('API Error')
    expect(result.scrobbles_processed).toBe(0)
    expect(result.tags_created).toBe(0)

    expect(upsertSyncState).toHaveBeenCalledWith(
      'testuser',
      expect.objectContaining({
        data_type: 'scrobbles',
        provider: 'lastfm',
        status: 'error',
      }),
    )
  })

  it('uses last sync time for incremental sync', async () => {
    const last_sync_time = new Date('2024-01-01T00:00:00Z')

    vi.mocked(getSyncState).mockResolvedValue({
      data_type: 'scrobbles',
      last_sync_time,
      provider: 'lastfm',
      status: 'idle',
    })
    vi.mocked(getLastFmTagRules).mockResolvedValue([])

    const mockClient = {
      getRecentTracks: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(lastfmClient).mockReturnValue(mockClient as unknown as ReturnType<typeof lastfmClient>)

    await syncLastFmData('testuser', 'api-key', 'lastfm-username')

    expect(mockClient.getRecentTracks).toHaveBeenCalledWith(
      'lastfm-username',
      last_sync_time,
      expect.any(Date),
    )
  })

  it('uses start date for full resync', async () => {
    const startDate = new Date('2023-01-01T00:00:00Z')

    vi.mocked(getSyncState).mockResolvedValue({
      data_type: 'scrobbles',
      last_sync_time: new Date('2024-01-01T00:00:00Z'),
      provider: 'lastfm',
      status: 'idle',
    })
    vi.mocked(getLastFmTagRules).mockResolvedValue([])

    const mockClient = {
      getRecentTracks: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(lastfmClient).mockReturnValue(mockClient as unknown as ReturnType<typeof lastfmClient>)

    await syncLastFmData('testuser', 'api-key', 'lastfm-username', {
      fullResync: true,
      startDate,
    })

    expect(mockClient.getRecentTracks).toHaveBeenCalledWith('lastfm-username', startDate, expect.any(Date))
  })
})

describe('scrobbleRecordToScrobble', () => {
  it('converts ScrobbleRecord to Scrobble', () => {
    const record: ScrobbleRecord = {
      album: 'Test Album',
      artist: 'Test Artist',
      recorded_at: new Date('2024-01-01T10:00:00Z'),
      track: 'Test Track',
    }

    const result = scrobbleRecordToScrobble(record)

    expect(result).toEqual({
      album: 'Test Album',
      artist: 'Test Artist',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      track: 'Test Track',
    })
  })

  it('converts empty album string to undefined', () => {
    const record: ScrobbleRecord = {
      album: '',
      artist: 'Test Artist',
      recorded_at: new Date('2024-01-01T10:00:00Z'),
      track: 'Test Track',
    }

    const result = scrobbleRecordToScrobble(record)

    expect(result.album).toBeUndefined()
  })
})

describe('applyRuleRetroactively', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('applies rule to all existing scrobbles', async () => {
    const records: ScrobbleRecord[] = [
      {
        album: 'Album 1',
        artist: 'Match Artist',
        recorded_at: new Date('2024-01-01T10:00:00Z'),
        track: 'Song 1',
      },
      {
        album: 'Album 2',
        artist: 'Other Artist',
        recorded_at: new Date('2024-01-01T11:00:00Z'),
        track: 'Song 2',
      },
    ]
    vi.mocked(getAllScrobbles).mockResolvedValue(records)

    const rule: LastFmTagRule = {
      artist_name: 'Match Artist',
      created_at: new Date(),
      id: 'rule-1',
      match_mode: 'exact',
      match_type: 'artist',
      rule_name: 'Test Rule',
      tag_name: 'TestTag',
    }

    const tagsCreated = await applyRuleRetroactively('testuser', rule)

    expect(tagsCreated).toBe(1)
    expect(getAllScrobbles).toHaveBeenCalledWith('testuser')
    expect(insertTag).toHaveBeenCalledTimes(1)
  })

  it('returns 0 when no scrobbles exist', async () => {
    vi.mocked(getAllScrobbles).mockResolvedValue([])

    const rule: LastFmTagRule = {
      artist_name: 'Any Artist',
      created_at: new Date(),
      id: 'rule-1',
      match_mode: 'exact',
      match_type: 'artist',
      rule_name: 'Test Rule',
      tag_name: 'TestTag',
    }

    const tagsCreated = await applyRuleRetroactively('testuser', rule)

    expect(tagsCreated).toBe(0)
    expect(insertTag).not.toHaveBeenCalled()
  })
})

describe('cleanupRuleTags', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('deletes point-in-time and session tags for the rule', async () => {
    vi.mocked(hardDeleteTagsByExternalIdPrefix).mockResolvedValueOnce(3).mockResolvedValueOnce(2)

    const deleted = await cleanupRuleTags('testuser', 'rule-abc')

    expect(deleted).toBe(5)
    expect(hardDeleteTagsByExternalIdPrefix).toHaveBeenCalledWith('testuser', 'lastfm-auto-rule-abc-')
    expect(hardDeleteTagsByExternalIdPrefix).toHaveBeenCalledWith('testuser', 'lastfm-session-rule-abc-')
  })

  it('returns 0 when no tags match', async () => {
    vi.mocked(hardDeleteTagsByExternalIdPrefix).mockResolvedValue(0)

    const deleted = await cleanupRuleTags('testuser', 'nonexistent')

    expect(deleted).toBe(0)
  })
})

describe('retagAllScrobbles', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('deletes all auto-tags and reapplies rules', async () => {
    vi.mocked(hardDeleteTagsBySource).mockResolvedValue(10)
    vi.mocked(getAllScrobbles).mockResolvedValue([
      {
        album: 'Album',
        artist: 'Match Artist',
        recorded_at: new Date('2024-01-01T10:00:00Z'),
        track: 'Song 1',
      },
    ])
    vi.mocked(getLastFmTagRules).mockResolvedValue([
      {
        artist_name: 'Match Artist',
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'artist',
        rule_name: 'Test Rule',
        tag_name: 'TestTag',
      },
    ])

    const result = await retagAllScrobbles('testuser')

    expect(result.tags_deleted).toBe(10)
    expect(result.tags_created).toBe(1)
    expect(hardDeleteTagsBySource).toHaveBeenCalledWith('testuser', 'lastfm-auto')
    expect(insertTag).toHaveBeenCalledTimes(1)
  })

  it('returns early when no scrobbles exist', async () => {
    vi.mocked(hardDeleteTagsBySource).mockResolvedValue(5)
    vi.mocked(getAllScrobbles).mockResolvedValue([])
    vi.mocked(getLastFmTagRules).mockResolvedValue([
      {
        artist_name: 'Any',
        created_at: new Date(),
        id: 'rule-1',
        match_mode: 'exact',
        match_type: 'artist',
        rule_name: 'Rule',
        tag_name: 'Tag',
      },
    ])

    const result = await retagAllScrobbles('testuser')

    expect(result.tags_deleted).toBe(5)
    expect(result.tags_created).toBe(0)
    expect(insertTag).not.toHaveBeenCalled()
  })

  it('returns early when no rules exist', async () => {
    vi.mocked(hardDeleteTagsBySource).mockResolvedValue(5)
    vi.mocked(getAllScrobbles).mockResolvedValue([
      {
        album: '',
        artist: 'Artist',
        recorded_at: new Date('2024-01-01T10:00:00Z'),
        track: 'Song',
      },
    ])
    vi.mocked(getLastFmTagRules).mockResolvedValue([])

    const result = await retagAllScrobbles('testuser')

    expect(result.tags_deleted).toBe(5)
    expect(result.tags_created).toBe(0)
    expect(insertTag).not.toHaveBeenCalled()
  })
})
