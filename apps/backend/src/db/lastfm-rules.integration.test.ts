import { randomUUID } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'
import { deleteLastFmTagRule, getLastFmTagRules, insertLastFmTagRule } from './lastfm-rules'

const CONTAINER_TIMEOUT = 60_000

describe('Last.fm Tag Rules Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('insertLastFmTagRule creates a new rule', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      matchMode: 'exact',
      matchType: 'track',
      ruleName: 'Vocal Exercises',
      tagName: 'VocalExercises',
      trackName: 'Warmup Track',
    })

    expect(rule.id).toBeDefined()
    expect(rule.ruleName).toBe('Vocal Exercises')
    expect(rule.matchType).toBe('track')
    expect(rule.trackName).toBe('Warmup Track')
    expect(rule.matchMode).toBe('exact')
    expect(rule.tagName).toBe('VocalExercises')
    expect(rule.createdAt).toBeInstanceOf(Date)
  })

  test('insertLastFmTagRule creates rule with artist match type', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      artistName: 'Relaxation Artist',
      matchMode: 'contains',
      matchType: 'artist',
      ruleName: 'Meditation Music',
      tagName: 'Meditation',
    })

    expect(rule.matchType).toBe('artist')
    expect(rule.artistName).toBe('Relaxation Artist')
    expect(rule.matchMode).toBe('contains')
    expect(rule.trackName).toBeUndefined()
  })

  test('insertLastFmTagRule creates rule with track_artist match type', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      artistName: 'Favorite Artist',
      matchMode: 'exact',
      matchType: 'track_artist',
      ruleName: 'Specific Song',
      tagName: 'FavoriteSong',
      trackName: 'Best Song',
    })

    expect(rule.matchType).toBe('track_artist')
    expect(rule.trackName).toBe('Best Song')
    expect(rule.artistName).toBe('Favorite Artist')
  })

  test('getLastFmTagRules returns all rules for user', async () => {
    const user = getTestUser()

    await insertLastFmTagRule(user, {
      matchMode: 'exact',
      matchType: 'track',
      ruleName: 'Rule 1',
      tagName: 'Tag1',
      trackName: 'Track 1',
    })
    await insertLastFmTagRule(user, {
      artistName: 'Artist 2',
      matchMode: 'contains',
      matchType: 'artist',
      ruleName: 'Rule 2',
      tagName: 'Tag2',
    })

    const rules = await getLastFmTagRules(user)

    expect(rules).toHaveLength(2)
    expect(rules.map((r) => r.ruleName).sort()).toEqual(['Rule 1', 'Rule 2'])
  })

  test('getLastFmTagRules returns empty array when no rules exist', async () => {
    const user = getTestUser()

    const rules = await getLastFmTagRules(user)

    expect(rules).toEqual([])
  })

  test('deleteLastFmTagRule deletes existing rule and returns true', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      matchMode: 'exact',
      matchType: 'track',
      ruleName: 'To Delete',
      tagName: 'ToDelete',
      trackName: 'Some Track',
    })

    const deleted = await deleteLastFmTagRule(user, rule.id)

    expect(deleted).toBe(true)

    const rules = await getLastFmTagRules(user)
    expect(rules).toHaveLength(0)
  })

  test('deleteLastFmTagRule returns false when rule not found', async () => {
    const user = getTestUser()

    const deleted = await deleteLastFmTagRule(user, randomUUID())

    expect(deleted).toBe(false)
  })

  test('insertLastFmTagRule rejects duplicate rules', async () => {
    const user = getTestUser()

    // Use track_artist match type so both track and artist have non-null values
    // (NULL values are not considered equal in PostgreSQL unique constraints)
    await insertLastFmTagRule(user, {
      artistName: 'Unique Artist',
      matchMode: 'exact',
      matchType: 'track_artist',
      ruleName: 'Original Rule',
      tagName: 'UniqueTag',
      trackName: 'Unique Track',
    })

    // Attempt to insert duplicate (same match_type, track_name, artist_name, tag_name)
    await expect(
      insertLastFmTagRule(user, {
        artistName: 'Unique Artist',
        matchMode: 'contains', // different mode, but still same unique key
        matchType: 'track_artist',
        ruleName: 'Duplicate Rule',
        tagName: 'UniqueTag',
        trackName: 'Unique Track',
      }),
    ).rejects.toThrow()
  })

  test('insertLastFmTagRule allows same track with different tag names', async () => {
    const user = getTestUser()

    await insertLastFmTagRule(user, {
      matchMode: 'exact',
      matchType: 'track',
      ruleName: 'Rule 1',
      tagName: 'Tag1',
      trackName: 'Same Track',
    })

    const rule2 = await insertLastFmTagRule(user, {
      matchMode: 'exact',
      matchType: 'track',
      ruleName: 'Rule 2',
      tagName: 'Tag2',
      trackName: 'Same Track',
    })

    expect(rule2.tagName).toBe('Tag2')

    const rules = await getLastFmTagRules(user)
    expect(rules).toHaveLength(2)
  })

  test('insertLastFmTagRule creates rule with mergeGapSeconds', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      artistName: 'Warmup Artist',
      matchMode: 'exact',
      matchType: 'artist',
      mergeGapSeconds: 600,
      ruleName: 'Session Rule',
      tagName: 'VocalExercise',
    })

    expect(rule.mergeGapSeconds).toBe(600)
  })

  test('insertLastFmTagRule creates rule with artistNames array', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      artistNames: ['Artist 1', 'Artist 2', 'Artist 3'],
      matchMode: 'exact',
      matchType: 'artist',
      ruleName: 'Multi-Artist Rule',
      tagName: 'Warmup',
    })

    expect(rule.artistNames).toEqual(['Artist 1', 'Artist 2', 'Artist 3'])
  })

  test('getLastFmTagRules returns rules with mergeGapSeconds and artistNames', async () => {
    const user = getTestUser()

    await insertLastFmTagRule(user, {
      artistNames: ['Artist A', 'Artist B'],
      matchMode: 'exact',
      matchType: 'artist',
      mergeGapSeconds: 300,
      ruleName: 'Session Rule',
      tagName: 'SessionTag',
    })

    const rules = await getLastFmTagRules(user)

    expect(rules).toHaveLength(1)
    expect(rules[0].mergeGapSeconds).toBe(300)
    expect(rules[0].artistNames).toEqual(['Artist A', 'Artist B'])
  })

  test('insertLastFmTagRule creates rule without mergeGapSeconds and artistNames', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      artistName: 'Some Artist',
      matchMode: 'exact',
      matchType: 'artist',
      ruleName: 'Simple Rule',
      tagName: 'SimpleTag',
    })

    expect(rule.mergeGapSeconds).toBeUndefined()
    expect(rule.artistNames).toBeUndefined()
  })

  test('insertLastFmTagRule defaults matchMode to exact', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      matchType: 'track',
      ruleName: 'Default Mode',
      tagName: 'TestTag',
      trackName: 'Test Track',
    })

    expect(rule.matchMode).toBe('exact')
  })
})
