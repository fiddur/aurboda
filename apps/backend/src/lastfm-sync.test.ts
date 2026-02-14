/**
 * Last.fm sync module tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LastFmTagRule } from './db'
import type { Scrobble } from './lastfm'
import { applyTagRules, matchesRule, syncLastFmData } from './lastfm-sync'

// Mock the db module
vi.mock('./db', () => ({
  findMergeableTag: vi.fn(),
  getLastFmTagRules: vi.fn(),
  getSyncState: vi.fn(),
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
  getLastFmTagRules,
  getSyncState,
  insertRawRecord,
  insertTag,
  updateTagEndTime,
  upsertSyncState,
} from './db'
import { lastfmClient } from './lastfm'

describe('matchesRule', () => {
  const baseScrobble: Scrobble = {
    album: 'Test Album',
    artist: 'Test Artist',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    track: 'Test Track',
  }

  const baseRule: LastFmTagRule = {
    createdAt: new Date(),
    id: 'rule-1',
    matchMode: 'exact',
    matchType: 'track',
    ruleName: 'Test Rule',
    tagName: 'TestTag',
  }

  describe('track match type', () => {
    it('matches exact track name (case insensitive)', () => {
      const rule = { ...baseRule, matchType: 'track' as const, trackName: 'Test Track' }
      expect(matchesRule(baseScrobble, rule)).toBe(true)

      const ruleUpperCase = { ...baseRule, matchType: 'track' as const, trackName: 'TEST TRACK' }
      expect(matchesRule(baseScrobble, ruleUpperCase)).toBe(true)
    })

    it('does not match different track name with exact mode', () => {
      const rule = { ...baseRule, matchType: 'track' as const, trackName: 'Different Track' }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('matches substring with contains mode', () => {
      const rule = {
        ...baseRule,
        matchMode: 'contains' as const,
        matchType: 'track' as const,
        trackName: 'Test',
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('returns false when trackName is missing', () => {
      const rule = { ...baseRule, matchType: 'track' as const }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })
  })

  describe('artist match type', () => {
    it('matches exact artist name (case insensitive)', () => {
      const rule = { ...baseRule, artistName: 'Test Artist', matchType: 'artist' as const }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('does not match different artist name with exact mode', () => {
      const rule = { ...baseRule, artistName: 'Different Artist', matchType: 'artist' as const }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('matches substring with contains mode', () => {
      const rule = {
        ...baseRule,
        artistName: 'Test',
        matchMode: 'contains' as const,
        matchType: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('returns false when artistName is missing', () => {
      const rule = { ...baseRule, matchType: 'artist' as const }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })
  })

  describe('track_artist match type', () => {
    it('matches when both track and artist match', () => {
      const rule = {
        ...baseRule,
        artistName: 'Test Artist',
        matchType: 'track_artist' as const,
        trackName: 'Test Track',
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('does not match when only track matches', () => {
      const rule = {
        ...baseRule,
        artistName: 'Different Artist',
        matchType: 'track_artist' as const,
        trackName: 'Test Track',
      }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('does not match when only artist matches', () => {
      const rule = {
        ...baseRule,
        artistName: 'Test Artist',
        matchType: 'track_artist' as const,
        trackName: 'Different Track',
      }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('returns false when trackName or artistName is missing', () => {
      const ruleNoTrack = { ...baseRule, artistName: 'Test Artist', matchType: 'track_artist' as const }
      const ruleNoArtist = { ...baseRule, matchType: 'track_artist' as const, trackName: 'Test Track' }

      expect(matchesRule(baseScrobble, ruleNoTrack)).toBe(false)
      expect(matchesRule(baseScrobble, ruleNoArtist)).toBe(false)
    })
  })

  describe('artistNames array matching', () => {
    it('matches when scrobble artist is in artistNames array (artist type)', () => {
      const rule = {
        ...baseRule,
        artistNames: ['Artist A', 'Test Artist', 'Artist B'],
        matchType: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('does not match when scrobble artist is not in artistNames array', () => {
      const rule = {
        ...baseRule,
        artistNames: ['Artist A', 'Artist B', 'Artist C'],
        matchType: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('artistNames takes precedence over artistName', () => {
      const rule = {
        ...baseRule,
        artistName: 'Test Artist', // would match
        artistNames: ['Different Artist'], // does not match, takes precedence
        matchType: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(false)
    })

    it('falls back to artistName when artistNames is empty', () => {
      const rule = {
        ...baseRule,
        artistName: 'Test Artist',
        artistNames: [] as string[],
        matchType: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('matches artistNames with contains mode', () => {
      const rule = {
        ...baseRule,
        artistNames: ['Artist A', 'Test'],
        matchMode: 'contains' as const,
        matchType: 'artist' as const,
      }
      expect(matchesRule(baseScrobble, rule)).toBe(true)
    })

    it('matches artistNames in track_artist type', () => {
      const rule = {
        ...baseRule,
        artistNames: ['Test Artist', 'Other Artist'],
        matchType: 'track_artist' as const,
        trackName: 'Test Track',
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
        createdAt: new Date(),
        id: 'rule-1',
        matchMode: 'exact',
        matchType: 'track',
        ruleName: 'Vocal Exercises',
        tagName: 'VocalExercises',
        trackName: 'Warmup Song',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    expect(tagsCreated).toBe(1)
    expect(insertTag).toHaveBeenCalledTimes(1)
    expect(insertTag).toHaveBeenCalledWith('testuser', {
      externalId: expect.stringMatching(/^lastfm-auto-rule-1-/),
      source: 'lastfm-auto',
      startTime: new Date('2024-01-01T10:00:00Z'),
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
        createdAt: new Date(),
        id: 'rule-1',
        matchMode: 'exact',
        matchType: 'track',
        ruleName: 'Rule 1',
        tagName: 'SameTag',
        trackName: 'Test Track',
      },
      {
        artistName: 'Test Artist',
        createdAt: new Date(),
        id: 'rule-2',
        matchMode: 'exact',
        matchType: 'artist',
        ruleName: 'Rule 2',
        tagName: 'SameTag',
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
        artistName: 'Warmup Artist',
        createdAt: new Date(),
        id: 'rule-1',
        matchMode: 'exact',
        matchType: 'artist',
        mergeGapSeconds: 600,
        ruleName: 'Vocal Exercises',
        tagName: 'VocalExercise',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    expect(tagsCreated).toBe(1)
    expect(insertTag).toHaveBeenCalledTimes(1)
    expect(insertTag).toHaveBeenCalledWith('testuser', {
      endTime: new Date('2024-01-01T10:08:00Z'),
      externalId: expect.stringMatching(/^lastfm-session-rule-1-/),
      source: 'lastfm-auto',
      startTime: new Date('2024-01-01T10:00:00Z'),
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
        artistName: 'Warmup Artist',
        createdAt: new Date(),
        id: 'rule-1',
        matchMode: 'exact',
        matchType: 'artist',
        mergeGapSeconds: 600,
        ruleName: 'Vocal Exercises',
        tagName: 'VocalExercise',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    expect(tagsCreated).toBe(2)
    expect(insertTag).toHaveBeenCalledTimes(2)
  })

  it('extends existing tag via findMergeableTag for cross-sync merging', async () => {
    const existingTag = {
      endTime: new Date('2024-01-01T09:58:00Z'),
      externalId: 'lastfm-session-rule-1-existing',
      id: 'tag-id-1',
      source: 'lastfm-auto' as const,
      startTime: new Date('2024-01-01T09:50:00Z'),
      tag: 'VocalExercise',
    }
    vi.mocked(findMergeableTag).mockResolvedValueOnce(existingTag)

    const scrobbles: Scrobble[] = [
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:02:00Z'), track: 'Song 1' },
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:06:00Z'), track: 'Song 2' },
    ]

    const rules: LastFmTagRule[] = [
      {
        artistName: 'Warmup Artist',
        createdAt: new Date(),
        id: 'rule-1',
        matchMode: 'exact',
        matchType: 'artist',
        mergeGapSeconds: 600,
        ruleName: 'Vocal Exercises',
        tagName: 'VocalExercise',
      },
    ]

    const tagsCreated = await applyTagRules('testuser', scrobbles, rules)

    expect(tagsCreated).toBe(1)
    expect(updateTagEndTime).toHaveBeenCalledWith(
      'testuser',
      'lastfm-session-rule-1-existing',
      new Date('2024-01-01T10:06:00Z'),
    )
    expect(insertTag).not.toHaveBeenCalled()
  })

  it('handles mix of point-in-time and session rules', async () => {
    vi.mocked(findMergeableTag).mockResolvedValue(undefined)

    const scrobbles: Scrobble[] = [
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:00:00Z'), track: 'Song 1' },
      { artist: 'Warmup Artist', timestamp: new Date('2024-01-01T10:04:00Z'), track: 'Song 2' },
    ]

    const rules: LastFmTagRule[] = [
      {
        artistName: 'Warmup Artist',
        createdAt: new Date(),
        id: 'rule-1',
        matchMode: 'exact',
        matchType: 'artist',
        mergeGapSeconds: 600,
        ruleName: 'Session Rule',
        tagName: 'SessionTag',
      },
      {
        artistName: 'Warmup Artist',
        createdAt: new Date(),
        id: 'rule-2',
        matchMode: 'exact',
        matchType: 'artist',
        ruleName: 'Point Rule',
        tagName: 'PointTag',
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
        createdAt: new Date(),
        id: 'rule-1',
        matchMode: 'exact',
        matchType: 'track',
        ruleName: 'Rule 1',
        tagName: 'Tag1',
        trackName: 'Test Track',
      },
      {
        artistName: 'Test Artist',
        createdAt: new Date(),
        id: 'rule-2',
        matchMode: 'exact',
        matchType: 'artist',
        ruleName: 'Rule 2',
        tagName: 'Tag2',
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
        createdAt: new Date(),
        id: 'rule-1',
        matchMode: 'exact',
        matchType: 'track',
        ruleName: 'Test Rule',
        tagName: 'TestTag',
        trackName: 'Test Track',
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
    expect(result.scrobblesProcessed).toBe(1)
    expect(result.tagsCreated).toBe(1)

    expect(insertRawRecord).toHaveBeenCalledTimes(1)
    expect(insertTag).toHaveBeenCalledTimes(1)
    expect(upsertSyncState).toHaveBeenCalledWith(
      'testuser',
      expect.objectContaining({
        dataType: 'scrobbles',
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
    expect(result.scrobblesProcessed).toBe(0)
    expect(result.tagsCreated).toBe(0)

    expect(upsertSyncState).toHaveBeenCalledWith(
      'testuser',
      expect.objectContaining({
        dataType: 'scrobbles',
        provider: 'lastfm',
        status: 'error',
      }),
    )
  })

  it('uses last sync time for incremental sync', async () => {
    const lastSyncTime = new Date('2024-01-01T00:00:00Z')

    vi.mocked(getSyncState).mockResolvedValue({
      dataType: 'scrobbles',
      lastSyncTime,
      provider: 'lastfm',
      status: 'idle',
    })
    vi.mocked(getLastFmTagRules).mockResolvedValue([])

    const mockClient = {
      getRecentTracks: vi.fn().mockResolvedValue([]),
    }
    vi.mocked(lastfmClient).mockReturnValue(mockClient as unknown as ReturnType<typeof lastfmClient>)

    await syncLastFmData('testuser', 'api-key', 'lastfm-username')

    expect(mockClient.getRecentTracks).toHaveBeenCalledWith('lastfm-username', lastSyncTime, expect.any(Date))
  })

  it('uses start date for full resync', async () => {
    const startDate = new Date('2023-01-01T00:00:00Z')

    vi.mocked(getSyncState).mockResolvedValue({
      dataType: 'scrobbles',
      lastSyncTime: new Date('2024-01-01T00:00:00Z'),
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
