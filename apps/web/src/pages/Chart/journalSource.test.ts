import { describe, expect, test } from 'vitest'

import {
  bucketLastDay,
  EMPTY_JOURNAL_STATE,
  journalBarHref,
  journalBreakdownOptions,
  journalFilters,
  parseJournalAggregation,
  parseJournalQuery,
} from './journalSource'

const PERSON = '00000000-0000-4000-8000-000000000001'
const WITH_COMMENTS = 'time,day,activity,meal,report'

const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).toISOString()

const query = (href: string) => Object.fromEntries(new URLSearchParams(href.split('?')[1]))

describe('parseJournalQuery', () => {
  test('no filters', () => {
    expect(parseJournalQuery({})).toEqual(EMPTY_JOURNAL_STATE)
  })

  test('reads the tags, the related filter, the search and the comments', () => {
    expect(
      parseJournalQuery({
        journal_entity_types: WITH_COMMENTS,
        journal_q: 'lake',
        journal_related_id: PERSON,
        journal_related_type: 'person',
        journal_tags: 'Travel,work,123',
      }),
    ).toEqual({
      journal_comments: true,
      journal_entity_types: '',
      journal_q: 'lake',
      journal_related: { id: PERSON, type: 'person' },
      journal_tags: ['travel', 'work'],
    })
  })

  test('the default entity types are the switch off', () => {
    expect(parseJournalQuery({ journal_entity_types: 'time,day' }).journal_comments).toBe(false)
  })

  test('another entity type list is kept as given, with the switch on', () => {
    expect(parseJournalQuery({ journal_entity_types: 'time,day,meal' })).toMatchObject({
      journal_comments: true,
      journal_entity_types: 'time,day,meal',
    })
  })

  test('a related filter needs a known type and a uuid', () => {
    expect(
      parseJournalQuery({ journal_related_id: 'x', journal_related_type: 'person' }).journal_related,
    ).toBe(undefined)
    expect(
      parseJournalQuery({ journal_related_id: PERSON, journal_related_type: 'pet' }).journal_related,
    ).toBe(undefined)
    expect(parseJournalQuery({ journal_related_id: PERSON }).journal_related).toBeUndefined()
  })
})

describe('journalFilters', () => {
  test('nothing for no filters', () => {
    expect(journalFilters(EMPTY_JOURNAL_STATE)).toEqual({})
  })

  test('the filters as the API names them', () => {
    expect(
      journalFilters({
        ...EMPTY_JOURNAL_STATE,
        journal_comments: true,
        journal_q: ' lake ',
        journal_tags: ['travel', 'work'],
      }),
    ).toEqual({ journal_entity_types: WITH_COMMENTS, journal_q: 'lake', journal_tags: 'travel,work' })
  })

  test('a related filter counts comments too', () => {
    expect(
      journalFilters({ ...EMPTY_JOURNAL_STATE, journal_related: { id: PERSON, type: 'person' } }),
    ).toEqual({
      journal_entity_types: WITH_COMMENTS,
      journal_related_id: PERSON,
      journal_related_type: 'person',
    })
  })

  test('keeps an entity type list the URL gave', () => {
    expect(
      journalFilters({
        ...EMPTY_JOURNAL_STATE,
        journal_comments: true,
        journal_entity_types: 'time,day,meal',
      }),
    ).toEqual({ journal_entity_types: 'time,day,meal' })
  })

  test('round-trips through the URL', () => {
    const state = {
      ...EMPTY_JOURNAL_STATE,
      journal_comments: true,
      journal_q: 'lake',
      journal_related: { id: PERSON, type: 'person' as const },
      journal_tags: ['travel'],
    }
    expect(parseJournalQuery(journalFilters(state))).toEqual(state)
  })
})

describe('aggregation', () => {
  test('entries or words, else entries', () => {
    expect(parseJournalAggregation('sum')).toBe('sum')
    expect(parseJournalAggregation('count')).toBe('count')
    expect(parseJournalAggregation('mean')).toBe('count')
    expect(parseJournalAggregation(undefined)).toBe('count')
  })
})

describe('journalBreakdownOptions', () => {
  test('Tags, and With only with people or an existing @people breakdown', () => {
    expect(journalBreakdownOptions([], false)).toEqual([{ label: 'Tags', name: '@tags' }])
    expect(journalBreakdownOptions([], true).map((o) => o.label)).toEqual(['Tags', 'With'])
    expect(journalBreakdownOptions(['@people'], false).map((o) => o.name)).toEqual(['@tags', '@people'])
  })
})

describe('bucketLastDay', () => {
  test('the day before the end of a day, week or month bucket', () => {
    expect(bucketLastDay(local(2026, 6, 1), '1d')).toBe('2026-06-01')
    expect(bucketLastDay(local(2026, 6, 1), '1w')).toBe('2026-06-07')
    expect(bucketLastDay(local(2026, 2, 1), '1M')).toBe('2026-02-28')
  })

  test("a shorter bucket's own day", () => {
    expect(bucketLastDay(local(2026, 6, 1, 23), '1h')).toBe('2026-06-01')
  })
})

describe('journalBarHref', () => {
  const bar = (series_name?: string) => ({ bucket_start: local(2026, 6, 1), series_name })

  test('the Journal at the bucket, filtered as the chart is', () => {
    expect(
      query(
        journalBarHref(bar(), '1w', undefined, {
          journal_entity_types: WITH_COMMENTS,
          journal_q: 'lake',
          journal_related_id: PERSON,
          journal_related_type: 'person',
          journal_tags: 'travel',
        }),
      ),
    ).toEqual({ comments: '1', date: '2026-06-07', person: PERSON, q: 'lake', tag: 'travel' })
  })

  test("adds the clicked series' tag", () => {
    expect(query(journalBarHref(bar('work'), '1d', ['@tags'], { journal_tags: 'travel' })).tag).toBe(
      'travel,work',
    )
    expect(query(journalBarHref(bar('work / Alex'), '1d', ['@tags', '@people'], {})).tag).toBe('work')
    expect(query(journalBarHref(bar('Alex / work'), '1d', ['@people', '@tags'], {})).tag).toBe('work')
  })

  test('no tag for (none), Other or a breakdown by people', () => {
    expect(query(journalBarHref(bar('(none)'), '1d', ['@tags'], {})).tag).toBeUndefined()
    expect(query(journalBarHref(bar('Other'), '1d', ['@tags', '@people'], {})).tag).toBeUndefined()
    expect(query(journalBarHref(bar('Sam'), '1d', ['@people'], {})).tag).toBeUndefined()
  })
})
