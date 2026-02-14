/**
 * Tags database integration tests using testcontainers.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  deleteTag,
  findMergeableTag,
  getProgrammaticTags,
  getTags,
  getUniqueTags,
  insertTag,
  isProgrammaticTag,
  updateTagEndTime,
} from '../db'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'

const CONTAINER_TIMEOUT = 60_000

describe('Tags Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('insertTag', () => {
    test('inserts a tag with start time only', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-1',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'coffee',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('coffee')
      expect(tags[0].externalId).toBe('tag-1')
      expect(tags[0].endTime).toBeUndefined()
    })

    test('inserts a tag with start and end time', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T11:00:00Z'),
        externalId: 'tag-2',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'meditation',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('meditation')
      expect(tags[0].endTime).toEqual(new Date('2024-01-15T11:00:00Z'))
    })

    test('upserts tag on conflict (same source + external_id)', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-3',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'coffee',
      })

      await insertTag(user, {
        externalId: 'tag-3',
        source: 'manual',
        startTime: new Date('2024-01-15T11:00:00Z'),
        tag: 'tea',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('tea')
      expect(tags[0].startTime).toEqual(new Date('2024-01-15T11:00:00Z'))
    })
  })

  describe('getTags', () => {
    test('returns tags within time range', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-a',
        source: 'manual',
        startTime: new Date('2024-01-14T10:00:00Z'),
        tag: 'before-range',
      })
      await insertTag(user, {
        externalId: 'tag-b',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'in-range',
      })
      await insertTag(user, {
        externalId: 'tag-c',
        source: 'manual',
        startTime: new Date('2024-01-16T10:00:00Z'),
        tag: 'after-range',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('in-range')
    })

    test('returns empty array when no tags in range', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-x',
        source: 'manual',
        startTime: new Date('2024-01-10T10:00:00Z'),
        tag: 'old-tag',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(0)
    })
  })

  describe('deleteTag', () => {
    test('deletes tag and returns true when found', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-to-delete',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'temporary',
      })

      const result = await deleteTag(user, 'tag-to-delete')
      expect(result).toBe(true)

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(0)
    })

    test('returns false when tag not found', async () => {
      const user = getTestUser()

      const result = await deleteTag(user, 'nonexistent-tag')
      expect(result).toBe(false)
    })
  })

  describe('findMergeableTag', () => {
    test('finds tag with end_time within merge span', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T09:59:00Z'),
        externalId: 'mergeable-tag',
        source: 'manual',
        startTime: new Date('2024-01-15T09:00:00Z'),
        tag: 'computer:dharma',
      })

      const result = await findMergeableTag(user, 'computer:dharma', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeDefined()
      expect(result!.externalId).toBe('mergeable-tag')
      expect(result!.tag).toBe('computer:dharma')
    })

    test('finds point-in-time tag (no end_time) within merge span', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'point-tag',
        source: 'manual',
        startTime: new Date('2024-01-15T09:58:00Z'),
        tag: 'coffee',
      })

      const result = await findMergeableTag(user, 'coffee', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeDefined()
      expect(result!.externalId).toBe('point-tag')
      expect(result!.endTime).toBeUndefined()
    })

    test('returns undefined when no tag within merge span', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T09:50:00Z'),
        externalId: 'old-tag',
        source: 'manual',
        startTime: new Date('2024-01-15T09:00:00Z'),
        tag: 'computer:dharma',
      })

      const result = await findMergeableTag(user, 'computer:dharma', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeUndefined()
    })

    test('only finds manual source tags', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T09:59:00Z'),
        externalId: 'oura-tag',
        source: 'oura',
        startTime: new Date('2024-01-15T09:00:00Z'),
        tag: 'meditation',
      })

      const result = await findMergeableTag(user, 'meditation', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeUndefined()
    })

    test('finds lastfm-auto source tags when source parameter is specified', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T09:59:00Z'),
        externalId: 'lastfm-session-1',
        source: 'lastfm-auto',
        startTime: new Date('2024-01-15T09:00:00Z'),
        tag: 'VocalExercise',
      })

      const result = await findMergeableTag(
        user,
        'VocalExercise',
        new Date('2024-01-15T10:00:00Z'),
        180,
        'lastfm-auto',
      )

      expect(result).toBeDefined()
      expect(result!.externalId).toBe('lastfm-session-1')
      expect(result!.source).toBe('lastfm-auto')
    })

    test('does not find lastfm-auto source tags when searching for manual', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T09:59:00Z'),
        externalId: 'lastfm-session-2',
        source: 'lastfm-auto',
        startTime: new Date('2024-01-15T09:00:00Z'),
        tag: 'VocalExercise',
      })

      const result = await findMergeableTag(user, 'VocalExercise', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeUndefined()
    })

    test('only finds tags with matching name', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T09:59:00Z'),
        externalId: 'different-tag',
        source: 'manual',
        startTime: new Date('2024-01-15T09:00:00Z'),
        tag: 'different-name',
      })

      const result = await findMergeableTag(user, 'computer:dharma', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeUndefined()
    })
  })

  describe('updateTagEndTime', () => {
    test('updates end_time and returns true when tag found', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T10:30:00Z'),
        externalId: 'tag-to-update',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'session',
      })

      const result = await updateTagEndTime(user, 'tag-to-update', new Date('2024-01-15T11:00:00Z'))
      expect(result).toBe(true)

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags[0].endTime).toEqual(new Date('2024-01-15T11:00:00Z'))
    })

    test('returns false when tag not found', async () => {
      const user = getTestUser()

      const result = await updateTagEndTime(user, 'nonexistent', new Date('2024-01-15T11:00:00Z'))
      expect(result).toBe(false)
    })
  })

  describe('getUniqueTags', () => {
    test('returns empty array when no tags exist', async () => {
      const user = getTestUser()

      const tags = await getUniqueTags(user)

      expect(tags).toEqual([])
    })

    test('returns unique tag names sorted alphabetically', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-1',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'coffee',
      })
      await insertTag(user, {
        externalId: 'tag-2',
        source: 'manual',
        startTime: new Date('2024-01-15T11:00:00Z'),
        tag: 'meditation',
      })
      await insertTag(user, {
        externalId: 'tag-3',
        source: 'manual',
        startTime: new Date('2024-01-15T12:00:00Z'),
        tag: 'coffee', // duplicate
      })
      await insertTag(user, {
        externalId: 'tag-4',
        source: 'oura',
        startTime: new Date('2024-01-15T13:00:00Z'),
        tag: 'apple',
      })

      const tags = await getUniqueTags(user)

      expect(tags).toEqual(['apple', 'coffee', 'meditation'])
    })
  })

  describe('isProgrammaticTag', () => {
    test('returns true for UUID tags', () => {
      expect(isProgrammaticTag('067e2862-8cf8-4307-a621-0636dd379cda')).toBe(true)
      expect(isProgrammaticTag('BD6D2689-103B-4AD8-9576-458E0C5325DF')).toBe(true) // uppercase
    })

    test('returns true for tag_* prefixed tags', () => {
      expect(isProgrammaticTag('tag_generic_coffee')).toBe(true)
      expect(isProgrammaticTag('tag_sleep_sauna')).toBe(true)
      expect(isProgrammaticTag('tag_generic_pain_killer')).toBe(true)
    })

    test('returns false for regular human-readable tags', () => {
      expect(isProgrammaticTag('coffee')).toBe(false)
      expect(isProgrammaticTag('Food')).toBe(false)
      expect(isProgrammaticTag('Hot Chocolate')).toBe(false)
      expect(isProgrammaticTag('meditation')).toBe(false)
    })
  })

  describe('getProgrammaticTags', () => {
    test('returns empty array when no tags exist', async () => {
      const user = getTestUser()

      const tags = await getProgrammaticTags(user)

      expect(tags).toEqual([])
    })

    test('returns UUID tags with counts from tags table', async () => {
      const user = getTestUser()
      const uuid1 = '067e2862-8cf8-4307-a621-0636dd379cda'
      const uuid2 = '4ddc8bc2-911d-467d-8c9d-dac2ece87d0a'

      // Insert tags directly to tags table (simulating how Oura sync stores them)
      await insertTag(user, {
        externalId: 'tag-1',
        source: 'oura',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: uuid1,
      })
      await insertTag(user, {
        externalId: 'tag-2',
        source: 'oura',
        startTime: new Date('2024-01-15T11:00:00Z'),
        tag: uuid1, // same tag, counted twice
      })
      await insertTag(user, {
        externalId: 'tag-3',
        source: 'oura',
        startTime: new Date('2024-01-15T12:00:00Z'),
        tag: uuid2,
      })

      const tags = await getProgrammaticTags(user)

      expect(tags).toHaveLength(2)
      // Sorted by latest time descending
      expect(tags[0].tagKey).toBe(uuid2)
      expect(tags[0].count).toBe(1)
      expect(tags[1].tagKey).toBe(uuid1)
      expect(tags[1].count).toBe(2)
    })

    test('returns tag_* prefixed tags', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-1',
        source: 'oura',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'tag_generic_coffee',
      })
      await insertTag(user, {
        externalId: 'tag-2',
        source: 'oura',
        startTime: new Date('2024-01-15T11:00:00Z'),
        tag: 'tag_sleep_sauna',
      })

      const tags = await getProgrammaticTags(user)

      expect(tags).toHaveLength(2)
      expect(tags.map((t) => t.tagKey).sort()).toEqual(['tag_generic_coffee', 'tag_sleep_sauna'])
    })

    test('excludes regular human-readable tags', async () => {
      const user = getTestUser()
      const uuid = '067e2862-8cf8-4307-a621-0636dd379cda'

      await insertTag(user, {
        externalId: 'tag-1',
        source: 'oura',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: uuid, // should be included
      })
      await insertTag(user, {
        externalId: 'tag-2',
        source: 'manual',
        startTime: new Date('2024-01-15T11:00:00Z'),
        tag: 'coffee', // should be excluded
      })
      await insertTag(user, {
        externalId: 'tag-3',
        source: 'manual',
        startTime: new Date('2024-01-15T12:00:00Z'),
        tag: 'Food', // should be excluded
      })

      const tags = await getProgrammaticTags(user)

      expect(tags).toHaveLength(1)
      expect(tags[0].tagKey).toBe(uuid)
    })
  })
})
