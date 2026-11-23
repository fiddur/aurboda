import type { Person } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  activityLabel,
  activityLink,
  addLink,
  dayActivityOptions,
  dayActivityWindow,
  insertMention,
  journalRefHeading,
  journalRefHref,
  journalRefWhen,
  mentionAt,
  mentionOptions,
  moveChoice,
  offeredPeople,
  refusedLinkKeys,
  relatedFilterFromQuery,
  relatedFilterHref,
  relatedHref,
  removeLink,
  sameLinks,
  unionLinks,
} from './related'

const ANNA = {
  entity_id: '00000000-0000-4000-8000-00000000000a',
  entity_type: 'person' as const,
  label: 'Anna',
}
const BO = { entity_id: '00000000-0000-4000-8000-00000000000b', entity_type: 'person' as const, label: 'Bo' }
const WALK = {
  entity_id: '00000000-0000-4000-8000-00000000000c',
  entity_type: 'activity' as const,
  label: 'Evening walk, 2026-11-20',
}

describe('the link list', () => {
  test('adds once, whatever the case of the id, and removes', () => {
    const links = addLink(addLink([ANNA], WALK), { ...ANNA, entity_id: ANNA.entity_id.toUpperCase() })
    expect(links).toEqual([ANNA, WALK])
    expect(removeLink(links, ANNA)).toEqual([WALK])
  })

  test('compares targets regardless of order and label, and unions them', () => {
    expect(sameLinks([ANNA, WALK], [WALK, { ...ANNA, label: 'Anna B.' }])).toBe(true)
    expect(sameLinks([ANNA], [ANNA, BO])).toBe(false)
    expect(unionLinks([ANNA], [BO, ANNA])).toEqual([ANNA, BO])
  })

  test('each chip opens the person or the activity', () => {
    expect(relatedHref(ANNA)).toBe(`/people/${ANNA.entity_id}`)
    expect(relatedHref(WALK)).toBe(`/detail/activity/${WALK.entity_id}`)
  })
})

describe('links a save refused', () => {
  test('marks the links an Unknown answer names, whatever the case of the id', () => {
    expect([
      ...refusedLinkKeys(`Unknown person: ${ANNA.entity_id.toUpperCase()}, ${BO.entity_id}`, [
        ANNA,
        BO,
        WALK,
      ]),
    ]).toEqual([`person:${ANNA.entity_id}`, `person:${BO.entity_id}`])
    expect([...refusedLinkKeys(`Unknown activity: ${WALK.entity_id}`, [ANNA, WALK])]).toEqual([
      `activity:${WALK.entity_id}`,
    ])
  })

  test('an id of the other kind or another answer marks nothing', () => {
    expect(refusedLinkKeys(`Unknown activity: ${ANNA.entity_id}`, [ANNA]).size).toBe(0)
    expect(refusedLinkKeys('Request failed with status code 500', [ANNA]).size).toBe(0)
  })
})

describe('typing @', () => {
  test('finds the @ being typed at the cursor, at the start of a word only', () => {
    expect(mentionAt('Dinner with @An', 15)).toEqual({ query: 'An', start: 12 })
    expect(mentionAt('@', 1)).toEqual({ query: '', start: 0 })
    expect(mentionAt('(@Bo', 4)).toEqual({ query: 'Bo', start: 1 })
    expect(mentionAt('mail me@home', 12)).toBeNull()
    expect(mentionAt('@Anna\nnext', 10)).toBeNull()
    expect(mentionAt('@ Anna', 6)).toBeNull()
    expect(mentionAt('No at here', 10)).toBeNull()
  })

  test('replaces the @query at the cursor with the name and a space, keeping the rest', () => {
    expect(insertMention('Dinner with @An and cake', 12, 15, 'Anna Berg')).toEqual({
      cursor: 21,
      text: 'Dinner with Anna Berg and cake',
    })
    expect(insertMention('Hi @b', 3, 5, 'Bo')).toEqual({ cursor: 6, text: 'Hi Bo ' })
  })

  test('offers names starting with the query first, at most eight', () => {
    const person = (id: string, name: string): Person =>
      ({ actor: null, archived: false, id, name, relationship: null }) as unknown as Person
    const people = [person('1', 'Johanna'), person('2', 'Anna'), person('3', 'Bo')]
    expect(mentionOptions(people, 'an').map((p) => p.name)).toEqual(['Anna', 'Johanna'])
    expect(mentionOptions(people, '')).toHaveLength(3)
    expect(
      mentionOptions(
        Array.from({ length: 12 }, (_, i) => person(String(i), `P${i}`)),
        'p',
      ),
    ).toHaveLength(8)
  })

  test('an archived person is not offered for a new link', () => {
    const people = [
      { archived: false, name: 'Anna' },
      { archived: true, name: 'Bo' },
    ]
    expect(offeredPeople(people).map((p) => p.name)).toEqual(['Anna'])
  })

  test('arrow keys wrap around the options', () => {
    expect(moveChoice(0, -1, 3)).toBe(2)
    expect(moveChoice(2, 1, 3)).toBe(0)
    expect(moveChoice(0, 1, 0)).toBe(0)
  })
})

describe("the day's activities", () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m)
  const sleep = { activity_type: 'sleep', end_time: at(20, 7), id: 'merged:s1', start_time: at(19, 23) }
  const run = {
    activity_type: 'running',
    end_time: at(20, 18),
    id: 'r1',
    start_time: at(20, 17),
    title: 'Tempo',
  }
  const walk = { activity_type: 'walking', end_time: at(20, 9), id: 'w1', start_time: at(20, 8) }
  const yesterday = { activity_type: 'walking', end_time: at(19, 18), id: 'y1', start_time: at(19, 17) }
  const tonight = { activity_type: 'sleep', end_time: at(21, 7), id: 's2', start_time: at(20, 23) }

  test('the night that ended that morning first, then the day in time order', () => {
    expect(dayActivityOptions([run, tonight, walk, yesterday, sleep], '2026-11-20').map((a) => a.id)).toEqual(
      ['merged:s1', 'w1', 'r1', 's2'],
    )
  })

  test('filters by type or title', () => {
    expect(dayActivityOptions([run, walk, sleep], '2026-11-20', 'walk').map((a) => a.id)).toEqual(['w1'])
    expect(dayActivityOptions([run, walk, sleep], '2026-11-20', 'tempo').map((a) => a.id)).toEqual(['r1'])
  })

  test('fetches from noon the day before to the end of the day', () => {
    expect(dayActivityWindow('2026-11-20')).toEqual({ end: new Date(2026, 10, 21), start: at(19, 12) })
  })

  test('a link uses the row id and labels it as the server does', () => {
    expect(activityLabel(walk)).toBe('Walking, 2026-11-20')
    expect(activityLink(sleep, () => 'Sleep')).toEqual({
      activity_type: 'sleep',
      entity_id: 's1',
      entity_type: 'activity',
      label: 'Sleep, 2026-11-20',
    })
    expect(activityLabel({ ...sleep, end_time: undefined }, () => 'Sleep')).toBe('Sleep, 2026-11-19')
    expect(activityLink(run).label).toBe('Tempo, 2026-11-20')
  })
})

describe('the Related to filter', () => {
  const id = '00000000-0000-4000-8000-00000000000a'

  test('reads ?person= and ?activity= and ignores anything else', () => {
    expect(relatedFilterFromQuery({ person: id })).toEqual({ id, type: 'person' })
    expect(relatedFilterFromQuery({ activity: `merged:${id}` })).toEqual({ id, type: 'activity' })
    expect(relatedFilterFromQuery({ person: 'nope' })).toBeUndefined()
    expect(relatedFilterFromQuery({})).toBeUndefined()
  })

  test('writes the link back', () => {
    expect(relatedFilterHref({ id, type: 'activity' })).toBe(`/journal?activity=${id}`)
  })
})

describe('journal entry rows', () => {
  test('a title, else the date, as the heading; the date under a title', () => {
    expect(journalRefHeading({ date: '2026-11-20', title: 'First snow' })).toBe('First snow')
    expect(journalRefWhen({ date: '2026-11-20', title: 'First snow' })).toBe('Fri 20 Nov 2026')
    expect(journalRefHeading({ date: '2026-11-20' })).toBe('Fri 20 Nov 2026')
    expect(journalRefWhen({ date: '2026-11-20' })).toBe('')
    expect(journalRefHeading({ start_time: new Date(2026, 10, 20, 8, 5).toISOString() })).toBe(
      'Fri 20 Nov 2026, 08:05',
    )
  })

  test('an entry opens in the editor; a comment on something else has no link', () => {
    expect(journalRefHref({ entity_type: 'day', id: 'n1' })).toBe('/journal/n1')
    expect(journalRefHref({ entity_type: 'activity', id: 'n2' })).toBeUndefined()
  })
})
