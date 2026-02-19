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
  updateTagNameByKey,
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
        external_id: 'tag-1',
        source: 'manual',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'coffee',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('coffee')
      expect(tags[0].external_id).toBe('tag-1')
      expect(tags[0].end_time).toBeUndefined()
    })

    test('inserts a tag with start and end time', async () => {
      const user = getTestUser()

      await insertTag(user, {
        end_time: new Date('2024-01-15T11:00:00Z'),
        external_id: 'tag-2',
        source: 'manual',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'meditation',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('meditation')
      expect(tags[0].end_time).toEqual(new Date('2024-01-15T11:00:00Z'))
    })

    test('upserts tag on conflict (same source + external_id)', async () => {
      const user = getTestUser()

      await insertTag(user, {
        external_id: 'tag-3',
        source: 'manual',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'coffee',
      })

      await insertTag(user, {
        external_id: 'tag-3',
        source: 'manual',
        start_time: new Date('2024-01-15T11:00:00Z'),
        tag: 'tea',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('tea')
      expect(tags[0].start_time).toEqual(new Date('2024-01-15T11:00:00Z'))
    })

    test('inserts a tag with tag_key', async () => {
      const user = getTestUser()
      const tagKey = '067e2862-8cf8-4307-a621-0636dd379cda'

      await insertTag(user, {
        external_id: 'oura-tag-1',
        source: 'oura',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'Food',
        tag_key: tagKey,
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('Food')
      expect(tags[0].tag_key).toBe(tagKey)
    })

    test('preserves tag_key on upsert when new value is undefined', async () => {
      const user = getTestUser()
      const tagKey = '067e2862-8cf8-4307-a621-0636dd379cda'

      await insertTag(user, {
        external_id: 'oura-tag-2',
        source: 'oura',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'Food',
        tag_key: tagKey,
      })

      // Upsert without tag_key should preserve existing tag_key
      await insertTag(user, {
        external_id: 'oura-tag-2',
        source: 'oura',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'Snack',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('Snack')
      expect(tags[0].tag_key).toBe(tagKey)
    })
  })

  describe('getTags', () => {
    test('returns tags within time range', async () => {
      const user = getTestUser()

      await insertTag(user, {
        external_id: 'tag-a',
        source: 'manual',
        start_time: new Date('2024-01-14T10:00:00Z'),
        tag: 'before-range',
      })
      await insertTag(user, {
        external_id: 'tag-b',
        source: 'manual',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'in-range',
      })
      await insertTag(user, {
        external_id: 'tag-c',
        source: 'manual',
        start_time: new Date('2024-01-16T10:00:00Z'),
        tag: 'after-range',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('in-range')
    })

    test('returns span tags that overlap the query range', async () => {
      const user = getTestUser()

      // Span tag that started before range but extends into it
      await insertTag(user, {
        end_time: new Date('2024-01-15T02:00:00Z'),
        external_id: 'tag-overlap',
        source: 'calendar',
        start_time: new Date('2024-01-14T23:00:00Z'),
        tag: '[Work] Late meeting',
      })

      // Span tag fully within range
      await insertTag(user, {
        end_time: new Date('2024-01-15T11:00:00Z'),
        external_id: 'tag-within',
        source: 'manual',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'meditation',
      })

      // Span tag that starts in range and extends past it
      await insertTag(user, {
        end_time: new Date('2024-01-16T02:00:00Z'),
        external_id: 'tag-extends',
        source: 'oura',
        start_time: new Date('2024-01-15T23:00:00Z'),
        tag: 'sleep',
      })

      // Span tag completely before range
      await insertTag(user, {
        end_time: new Date('2024-01-14T12:00:00Z'),
        external_id: 'tag-before',
        source: 'manual',
        start_time: new Date('2024-01-14T10:00:00Z'),
        tag: 'old-meeting',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(3)
      expect(tags.map((t) => t.tag).sort()).toEqual(['[Work] Late meeting', 'meditation', 'sleep'])
    })

    test('returns empty array when no tags in range', async () => {
      const user = getTestUser()

      await insertTag(user, {
        external_id: 'tag-x',
        source: 'manual',
        start_time: new Date('2024-01-10T10:00:00Z'),
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
        external_id: 'tag-to-delete',
        source: 'manual',
        start_time: new Date('2024-01-15T10:00:00Z'),
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
        end_time: new Date('2024-01-15T09:59:00Z'),
        external_id: 'mergeable-tag',
        source: 'manual',
        start_time: new Date('2024-01-15T09:00:00Z'),
        tag: 'computer:dharma',
      })

      const result = await findMergeableTag(user, 'computer:dharma', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeDefined()
      expect(result!.external_id).toBe('mergeable-tag')
      expect(result!.tag).toBe('computer:dharma')
    })

    test('finds point-in-time tag (no end_time) within merge span', async () => {
      const user = getTestUser()

      await insertTag(user, {
        external_id: 'point-tag',
        source: 'manual',
        start_time: new Date('2024-01-15T09:58:00Z'),
        tag: 'coffee',
      })

      const result = await findMergeableTag(user, 'coffee', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeDefined()
      expect(result!.external_id).toBe('point-tag')
      expect(result!.end_time).toBeUndefined()
    })

    test('returns undefined when no tag within merge span', async () => {
      const user = getTestUser()

      await insertTag(user, {
        end_time: new Date('2024-01-15T09:50:00Z'),
        external_id: 'old-tag',
        source: 'manual',
        start_time: new Date('2024-01-15T09:00:00Z'),
        tag: 'computer:dharma',
      })

      const result = await findMergeableTag(user, 'computer:dharma', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeUndefined()
    })

    test('only finds manual source tags', async () => {
      const user = getTestUser()

      await insertTag(user, {
        end_time: new Date('2024-01-15T09:59:00Z'),
        external_id: 'oura-tag',
        source: 'oura',
        start_time: new Date('2024-01-15T09:00:00Z'),
        tag: 'meditation',
      })

      const result = await findMergeableTag(user, 'meditation', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeUndefined()
    })

    test('finds lastfm-auto source tags when source parameter is specified', async () => {
      const user = getTestUser()

      await insertTag(user, {
        end_time: new Date('2024-01-15T09:59:00Z'),
        external_id: 'lastfm-session-1',
        source: 'lastfm-auto',
        start_time: new Date('2024-01-15T09:00:00Z'),
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
      expect(result!.external_id).toBe('lastfm-session-1')
      expect(result!.source).toBe('lastfm-auto')
    })

    test('does not find lastfm-auto source tags when searching for manual', async () => {
      const user = getTestUser()

      await insertTag(user, {
        end_time: new Date('2024-01-15T09:59:00Z'),
        external_id: 'lastfm-session-2',
        source: 'lastfm-auto',
        start_time: new Date('2024-01-15T09:00:00Z'),
        tag: 'VocalExercise',
      })

      const result = await findMergeableTag(user, 'VocalExercise', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeUndefined()
    })

    test('only finds tags with matching name', async () => {
      const user = getTestUser()

      await insertTag(user, {
        end_time: new Date('2024-01-15T09:59:00Z'),
        external_id: 'different-tag',
        source: 'manual',
        start_time: new Date('2024-01-15T09:00:00Z'),
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
        end_time: new Date('2024-01-15T10:30:00Z'),
        external_id: 'tag-to-update',
        source: 'manual',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'session',
      })

      const result = await updateTagEndTime(user, 'tag-to-update', new Date('2024-01-15T11:00:00Z'))
      expect(result).toBe(true)

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags[0].end_time).toEqual(new Date('2024-01-15T11:00:00Z'))
    })

    test('returns false when tag not found', async () => {
      const user = getTestUser()

      const result = await updateTagEndTime(user, 'nonexistent', new Date('2024-01-15T11:00:00Z'))
      expect(result).toBe(false)
    })
  })

  describe('updateTagNameByKey', () => {
    test('updates all tags with matching tag_key', async () => {
      const user = getTestUser()
      const tagKey = '067e2862-8cf8-4307-a621-0636dd379cda'

      await insertTag(user, {
        external_id: 'oura-1',
        source: 'oura',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'YinYoga',
        tag_key: tagKey,
      })
      await insertTag(user, {
        external_id: 'oura-2',
        source: 'oura',
        start_time: new Date('2024-01-16T10:00:00Z'),
        tag: 'YinYoga',
        tag_key: tagKey,
      })
      await insertTag(user, {
        external_id: 'oura-3',
        source: 'oura',
        start_time: new Date('2024-01-17T10:00:00Z'),
        tag: 'coffee',
        tag_key: 'tag_generic_coffee',
      })

      const updated = await updateTagNameByKey(user, tagKey, 'Food')
      expect(updated).toBe(2)

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-17T23:59:59Z'))
      const foodTags = tags.filter((t) => t.tag === 'Food')
      const coffeeTags = tags.filter((t) => t.tag === 'coffee')
      expect(foodTags).toHaveLength(2)
      expect(coffeeTags).toHaveLength(1)
    })

    test('returns 0 when no tags match', async () => {
      const user = getTestUser()

      const updated = await updateTagNameByKey(user, 'nonexistent-key', 'NewName')
      expect(updated).toBe(0)
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
        external_id: 'tag-1',
        source: 'manual',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'coffee',
      })
      await insertTag(user, {
        external_id: 'tag-2',
        source: 'manual',
        start_time: new Date('2024-01-15T11:00:00Z'),
        tag: 'meditation',
      })
      await insertTag(user, {
        external_id: 'tag-3',
        source: 'manual',
        start_time: new Date('2024-01-15T12:00:00Z'),
        tag: 'coffee', // duplicate
      })
      await insertTag(user, {
        external_id: 'tag-4',
        source: 'oura',
        start_time: new Date('2024-01-15T13:00:00Z'),
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

    test('returns tags with tag_key set (mapped tags)', async () => {
      const user = getTestUser()
      const uuid1 = '067e2862-8cf8-4307-a621-0636dd379cda'
      const uuid2 = '4ddc8bc2-911d-467d-8c9d-dac2ece87d0a'

      // Tags with tag_key set (post-migration: tag has display name, tag_key has original)
      await insertTag(user, {
        external_id: 'tag-1',
        source: 'oura',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'Food',
        tag_key: uuid1,
      })
      await insertTag(user, {
        external_id: 'tag-2',
        source: 'oura',
        start_time: new Date('2024-01-15T11:00:00Z'),
        tag: 'Food',
        tag_key: uuid1, // same tag_key, counted twice
      })
      await insertTag(user, {
        external_id: 'tag-3',
        source: 'oura',
        start_time: new Date('2024-01-15T12:00:00Z'),
        tag: 'Sauna',
        tag_key: uuid2,
      })

      const tags = await getProgrammaticTags(user)

      expect(tags).toHaveLength(2)
      // Sorted by latest time descending
      expect(tags[0].tagKey).toBe(uuid2)
      expect(tags[0].count).toBe(1)
      expect(tags[1].tagKey).toBe(uuid1)
      expect(tags[1].count).toBe(2)
    })

    test('falls back to programmatic tag names without tag_key (pre-migration)', async () => {
      const user = getTestUser()
      const uuid = '067e2862-8cf8-4307-a621-0636dd379cda'

      // Pre-migration tag: no tag_key, tag has the UUID directly
      await insertTag(user, {
        external_id: 'tag-1',
        source: 'oura',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: uuid,
      })
      await insertTag(user, {
        external_id: 'tag-2',
        source: 'oura',
        start_time: new Date('2024-01-15T11:00:00Z'),
        tag: 'tag_sleep_sauna',
      })

      const tags = await getProgrammaticTags(user)

      expect(tags).toHaveLength(2)
      expect(tags.map((t) => t.tagKey).sort()).toEqual([uuid, 'tag_sleep_sauna'])
    })

    test('excludes regular human-readable tags', async () => {
      const user = getTestUser()
      const uuid = '067e2862-8cf8-4307-a621-0636dd379cda'

      await insertTag(user, {
        external_id: 'tag-1',
        source: 'oura',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'Food',
        tag_key: uuid, // should be included (has tag_key)
      })
      await insertTag(user, {
        external_id: 'tag-2',
        source: 'manual',
        start_time: new Date('2024-01-15T11:00:00Z'),
        tag: 'coffee', // should be excluded (no tag_key, not programmatic)
      })
      await insertTag(user, {
        external_id: 'tag-3',
        source: 'manual',
        start_time: new Date('2024-01-15T12:00:00Z'),
        tag: 'Food', // should be excluded (no tag_key, not programmatic)
      })

      const tags = await getProgrammaticTags(user)

      expect(tags).toHaveLength(1)
      expect(tags[0].tagKey).toBe(uuid)
    })

    test('deduplicates between tag_key and fallback results', async () => {
      const user = getTestUser()
      const uuid = '067e2862-8cf8-4307-a621-0636dd379cda'

      // Tag with tag_key set
      await insertTag(user, {
        external_id: 'tag-1',
        source: 'oura',
        start_time: new Date('2024-01-15T10:00:00Z'),
        tag: 'Food',
        tag_key: uuid,
      })
      // Pre-migration tag with same UUID as tag name (no tag_key)
      await insertTag(user, {
        external_id: 'tag-2',
        source: 'oura',
        start_time: new Date('2024-01-15T11:00:00Z'),
        tag: uuid,
      })

      const tags = await getProgrammaticTags(user)

      // Should not duplicate - tag_key result should take precedence
      const uuidEntries = tags.filter((t) => t.tagKey === uuid)
      expect(uuidEntries).toHaveLength(1)
    })
  })
})
