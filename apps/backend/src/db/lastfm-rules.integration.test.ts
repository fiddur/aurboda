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
      match_mode: 'exact',
      match_type: 'track',
      rule_name: 'Vocal Exercises',
      tag_name: 'VocalExercises',
      track_name: 'Warmup Track',
    })

    expect(rule.id).toBeDefined()
    expect(rule.rule_name).toBe('Vocal Exercises')
    expect(rule.match_type).toBe('track')
    expect(rule.track_name).toBe('Warmup Track')
    expect(rule.match_mode).toBe('exact')
    expect(rule.tag_name).toBe('VocalExercises')
    expect(rule.created_at).toBeInstanceOf(Date)
  })

  test('insertLastFmTagRule creates rule with artist match type', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      artist_name: 'Relaxation Artist',
      match_mode: 'contains',
      match_type: 'artist',
      rule_name: 'Meditation Music',
      tag_name: 'Meditation',
    })

    expect(rule.match_type).toBe('artist')
    expect(rule.artist_name).toBe('Relaxation Artist')
    expect(rule.match_mode).toBe('contains')
    expect(rule.track_name).toBeUndefined()
  })

  test('insertLastFmTagRule creates rule with track_artist match type', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      artist_name: 'Favorite Artist',
      match_mode: 'exact',
      match_type: 'track_artist',
      rule_name: 'Specific Song',
      tag_name: 'FavoriteSong',
      track_name: 'Best Song',
    })

    expect(rule.match_type).toBe('track_artist')
    expect(rule.track_name).toBe('Best Song')
    expect(rule.artist_name).toBe('Favorite Artist')
  })

  test('getLastFmTagRules returns all rules for user', async () => {
    const user = getTestUser()

    await insertLastFmTagRule(user, {
      match_mode: 'exact',
      match_type: 'track',
      rule_name: 'Rule 1',
      tag_name: 'Tag1',
      track_name: 'Track 1',
    })
    await insertLastFmTagRule(user, {
      artist_name: 'Artist 2',
      match_mode: 'contains',
      match_type: 'artist',
      rule_name: 'Rule 2',
      tag_name: 'Tag2',
    })

    const rules = await getLastFmTagRules(user)

    expect(rules).toHaveLength(2)
    expect(rules.map((r) => r.rule_name).sort()).toEqual(['Rule 1', 'Rule 2'])
  })

  test('getLastFmTagRules returns empty array when no rules exist', async () => {
    const user = getTestUser()

    const rules = await getLastFmTagRules(user)

    expect(rules).toEqual([])
  })

  test('deleteLastFmTagRule deletes existing rule and returns true', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      match_mode: 'exact',
      match_type: 'track',
      rule_name: 'To Delete',
      tag_name: 'ToDelete',
      track_name: 'Some Track',
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
      artist_name: 'Unique Artist',
      match_mode: 'exact',
      match_type: 'track_artist',
      rule_name: 'Original Rule',
      tag_name: 'UniqueTag',
      track_name: 'Unique Track',
    })

    // Attempt to insert duplicate (same match_type, track_name, artist_name, tag_name)
    await expect(
      insertLastFmTagRule(user, {
        artist_name: 'Unique Artist',
        match_mode: 'contains', // different mode, but still same unique key
        match_type: 'track_artist',
        rule_name: 'Duplicate Rule',
        tag_name: 'UniqueTag',
        track_name: 'Unique Track',
      }),
    ).rejects.toThrow()
  })

  test('insertLastFmTagRule allows same track with different tag names', async () => {
    const user = getTestUser()

    await insertLastFmTagRule(user, {
      match_mode: 'exact',
      match_type: 'track',
      rule_name: 'Rule 1',
      tag_name: 'Tag1',
      track_name: 'Same Track',
    })

    const rule2 = await insertLastFmTagRule(user, {
      match_mode: 'exact',
      match_type: 'track',
      rule_name: 'Rule 2',
      tag_name: 'Tag2',
      track_name: 'Same Track',
    })

    expect(rule2.tag_name).toBe('Tag2')

    const rules = await getLastFmTagRules(user)
    expect(rules).toHaveLength(2)
  })

  test('insertLastFmTagRule creates rule with merge_gap_seconds', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      artist_name: 'Warmup Artist',
      match_mode: 'exact',
      match_type: 'artist',
      merge_gap_seconds: 600,
      rule_name: 'Session Rule',
      tag_name: 'VocalExercise',
    })

    expect(rule.merge_gap_seconds).toBe(600)
  })

  test('insertLastFmTagRule creates rule with artist_names array', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      artist_names: ['Artist 1', 'Artist 2', 'Artist 3'],
      match_mode: 'exact',
      match_type: 'artist',
      rule_name: 'Multi-Artist Rule',
      tag_name: 'Warmup',
    })

    expect(rule.artist_names).toEqual(['Artist 1', 'Artist 2', 'Artist 3'])
  })

  test('getLastFmTagRules returns rules with merge_gap_seconds and artist_names', async () => {
    const user = getTestUser()

    await insertLastFmTagRule(user, {
      artist_names: ['Artist A', 'Artist B'],
      match_mode: 'exact',
      match_type: 'artist',
      merge_gap_seconds: 300,
      rule_name: 'Session Rule',
      tag_name: 'SessionTag',
    })

    const rules = await getLastFmTagRules(user)

    expect(rules).toHaveLength(1)
    expect(rules[0].merge_gap_seconds).toBe(300)
    expect(rules[0].artist_names).toEqual(['Artist A', 'Artist B'])
  })

  test('insertLastFmTagRule creates rule without merge_gap_seconds and artist_names', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      artist_name: 'Some Artist',
      match_mode: 'exact',
      match_type: 'artist',
      rule_name: 'Simple Rule',
      tag_name: 'SimpleTag',
    })

    expect(rule.merge_gap_seconds).toBeUndefined()
    expect(rule.artist_names).toBeUndefined()
  })

  test('insertLastFmTagRule defaults match_mode to exact', async () => {
    const user = getTestUser()

    const rule = await insertLastFmTagRule(user, {
      match_type: 'track',
      rule_name: 'Default Mode',
      tag_name: 'TestTag',
      track_name: 'Test Track',
    })

    expect(rule.match_mode).toBe('exact')
  })
})
