import type { Person } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  activityLabel,
  activityLink,
  addLink,
  checkInLabel,
  checkInLink,
  dayActivityOptions,
  dayActivityWindow,
  dayCheckInOptions,
  dayMealOptions,
  dayWindow,
  isRelatedLink,
  insertMention,
  journalRefHeading,
  journalRefHref,
  journalRefWhen,
  mealLabel,
  mealLink,
  MENTION_MAX_OPTIONS,
  mentionAt,
  highlighted,
  keyPicks,
  mentionItems,
  mentionOptions,
  moveChoice,
  offeredPeople,
  refusedLinkKeys,
  relatedFilterFromQuery,
  relatedFilterHref,
  relatedFilterLabel,
  relatedFilterLinks,
  relatedHref,
  removeLink,
  reportLabel,
  zonedDate,
  zonedTime,
  reportLink,
  reportOptions,
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

  test('each chip opens its target: a check-in opens its form', () => {
    const id = WALK.entity_id
    expect(relatedHref(ANNA)).toBe(`/people/${ANNA.entity_id}`)
    expect(relatedHref(WALK)).toBe(`/detail/activity/${id}`)
    expect(relatedHref({ entity_id: id, entity_type: 'meal' })).toBe(`/meals/${id}`)
    expect(relatedHref({ entity_id: id, entity_type: 'report' })).toBe(`/reports/${id}`)
    expect(relatedHref({ entity_id: id, entity_type: 'check_in', form_id: 'f1' })).toBe('/check-ins/f1')
    expect(relatedHref({ entity_id: id, entity_type: 'check_in' })).toBe('/check-ins')
  })

  test('a kept draft link is any of the five kinds, with a label', () => {
    for (const entity_type of ['person', 'activity', 'meal', 'report', 'check_in']) {
      expect(isRelatedLink({ entity_id: 'x', entity_type, label: 'L' })).toBe(true)
    }
    expect(isRelatedLink({ entity_id: 'x', entity_type: 'place', label: 'L' })).toBe(false)
    expect(isRelatedLink({ entity_id: 'x', entity_type: 'meal' })).toBe(false)
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

  test('marks a meal, a report or a check-in the answer names', () => {
    const lunch = { entity_id: ANNA.entity_id, entity_type: 'meal' as const, label: 'Lunch 12:30' }
    const mood = { entity_id: BO.entity_id, entity_type: 'check_in' as const, label: 'Mood 08:00' }
    expect([...refusedLinkKeys(`Unknown meal: ${lunch.entity_id}`, [ANNA, lunch])]).toEqual([
      `meal:${lunch.entity_id}`,
    ])
    expect([...refusedLinkKeys(`Unknown check-in: ${mood.entity_id}`, [BO, mood])]).toEqual([
      `check_in:${mood.entity_id}`,
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

  const person = (id: string, name: string, archived = false): Person =>
    ({ actor: null, archived, id, name, relationship: null }) as unknown as Person

  test('offers names starting with the query first', () => {
    const people = [person('1', 'Johanna'), person('2', 'Anna'), person('3', 'Bo')]
    expect(mentionOptions(people, 'an').map((p) => p.name)).toEqual(['Anna', 'Johanna'])
    expect(mentionOptions(people, '')).toHaveLength(3)
  })

  test('matches names ignoring accents, starts first', () => {
    const people = [person('1', 'Anna-Thérèse'), person('2', 'Thérèse'), person('3', 'Theo')]
    expect(mentionOptions(people, 'therese').map((p) => p.name)).toEqual(['Thérèse', 'Anna-Thérèse'])
    expect(mentionOptions(people, 'Thé').map((p) => p.name)).toEqual(['Thérèse', 'Theo', 'Anna-Thérèse'])
  })

  test('offers everyone who matches, well past a handful, up to the cap', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => person(String(i), `P${i}`))
    expect(mentionOptions(many(12), 'p')).toHaveLength(12)
    expect(mentionOptions(many(MENTION_MAX_OPTIONS + 5), 'p')).toHaveLength(MENTION_MAX_OPTIONS)
  })

  test('the menu ends with adding the typed name as a person when nobody has it yet', () => {
    const anna = person('1', 'Anna')
    const cy = person('2', 'Cy', true)
    expect(mentionItems([anna], [anna, cy], 'An')).toEqual([
      { kind: 'person', person: anna },
      { kind: 'new', name: 'An' },
    ])
    expect(mentionItems([anna], [anna, cy], 'Dana ')).toEqual([{ kind: 'new', name: 'Dana' }])
  })

  test('the menu offers no new person for a bare @ or a name somebody has, archived or not', () => {
    const anna = person('1', 'Anna')
    const cy = person('2', 'Cy', true)
    expect(mentionItems([anna], [anna, cy], '')).toEqual([{ kind: 'person', person: anna }])
    expect(mentionItems([anna], [anna, cy], 'anna')).toEqual([{ kind: 'person', person: anna }])
    expect(mentionItems([anna], [anna, cy], 'cy')).toEqual([])
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

describe('meals, reports and check-ins to pick', () => {
  const at = (hour: number, minute = 0, day = 20) => new Date(2026, 10, day, hour, minute)

  test('a meal is labelled with its type and local time, as the server does', () => {
    expect(mealLabel({ meal_type: 'lunch', time: at(12, 30) })).toBe('Lunch 12:30')
    expect(mealLabel({ time: at(8) })).toBe('Meal 08:00')
    expect(mealLink({ id: 'm1', meal_type: 'dinner', time: at(18) })).toEqual({
      entity_id: 'm1',
      entity_type: 'meal',
      label: 'Dinner 18:00',
    })
  })

  test('a report with its type and local date, a check-in with its form and time and its form id', () => {
    expect(reportLabel({ date: at(9), report_type: 'blood_panel' })).toBe('Blood Panel, 2026-11-20')
    expect(reportLink({ date: at(9), id: 'r1', report_type: 'inbody' }).entity_type).toBe('report')
    const answered_at = at(7, 45).toISOString()
    expect(checkInLabel({ answered_at, form_name: 'Morning' })).toBe('Morning 07:45')
    expect(checkInLink({ answered_at, form_id: 'f1', form_name: 'Morning', id: 'c1' })).toEqual({
      entity_id: 'c1',
      entity_type: 'check_in',
      form_id: 'f1',
      label: 'Morning 07:45',
    })
  })

  test("the day's meals and answered check-ins in time order, others left out", () => {
    const meals = [{ time: at(18) }, { time: at(8) }, { time: at(12, 0, 21) }]
    expect(dayMealOptions(meals, '2026-11-20')).toEqual([{ time: at(8) }, { time: at(18) }])
    const checkIns = [
      { answered_at: at(20).toISOString(), status: 'answered' as const },
      { answered_at: at(7).toISOString(), status: 'answered' as const },
      { answered_at: at(8).toISOString(), status: 'skipped' as const },
      { answered_at: at(7, 0, 19).toISOString(), status: 'answered' as const },
    ]
    expect(dayCheckInOptions(checkIns, '2026-11-20').map((c) => c.answered_at)).toEqual([
      at(7).toISOString(),
      at(20).toISOString(),
    ])
    expect(dayWindow('2026-11-20')).toEqual({ end: new Date(2026, 10, 21), start: new Date(2026, 10, 20) })
  })

  test('reports newest first, searchable by type as written or as shown', () => {
    const reports = [
      { date: at(9, 0, 1), report_type: 'inbody' },
      { date: at(9, 0, 10), report_type: 'blood_panel' },
    ]
    expect(reportOptions(reports).map((r) => r.report_type)).toEqual(['blood_panel', 'inbody'])
    expect(reportOptions(reports, 'blood p').map((r) => r.report_type)).toEqual(['blood_panel'])
    expect(reportOptions(reports, 'INB').map((r) => r.report_type)).toEqual(['inbody'])
  })
})

describe('the Related to filter', () => {
  const id = '00000000-0000-4000-8000-00000000000a'

  test('reads ?person= and ?activity= and ignores anything else', () => {
    expect(relatedFilterFromQuery({ person: id })).toEqual({ id, type: 'person' })
    expect(relatedFilterFromQuery({ activity: `merged:${id}` })).toEqual({ id, type: 'activity' })
    expect(relatedFilterFromQuery({ meal: id })).toEqual({ id, type: 'meal' })
    expect(relatedFilterFromQuery({ report: id })).toEqual({ id, type: 'report' })
    expect(relatedFilterFromQuery({ check_in: id })).toEqual({ id, type: 'check_in' })
    expect(relatedFilterFromQuery({ person: 'nope' })).toBeUndefined()
    expect(relatedFilterFromQuery({})).toBeUndefined()
  })

  test('writes the link back', () => {
    expect(relatedFilterHref({ id, type: 'activity' })).toBe(`/journal?activity=${id}`)
    expect(relatedFilterHref({ id, type: 'check_in' })).toBe(`/journal?check_in=${id}`)
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

describe('Enter and Tab in the @ menu', () => {
  const person = { kind: 'person' as const, person: { id: 'a', name: 'Anna' } }
  const fresh = { kind: 'new' as const, name: 'Anna today' }

  test('take a person, but "add as a person" only once arrowed to', () => {
    expect(keyPicks(person, false)).toBe(true)
    expect(keyPicks(fresh, false)).toBe(false)
    expect(keyPicks(fresh, true)).toBe(true)
  })

  test('the default highlight is never "add as a person"', () => {
    expect(highlighted([fresh], 0, false)).toBe(-1)
    expect(highlighted([fresh], 0, true)).toBe(0)
    expect(highlighted([person, fresh], 0, false)).toBe(0)
  })
})

describe('relatedFilterLabel', () => {
  const id = '9d0124e7-d161-4855-a54f-fa8bdb45c4f2'
  const people = [{ id, name: 'Anna' }]

  test('Anyone without a filter', () => {
    expect(relatedFilterLabel(undefined, people, undefined)).toBe('Anyone')
  })

  test("a person's name, or Someone while it is unknown", () => {
    expect(relatedFilterLabel({ id, type: 'person' }, people, undefined)).toBe('Anna')
    expect(relatedFilterLabel({ id, type: 'person' }, [], undefined)).toBe('Someone')
  })

  test("an activity's label once loaded", () => {
    expect(relatedFilterLabel({ id, type: 'activity' }, people, 'Walk, 2026-11-20')).toBe('Walk, 2026-11-20')
    expect(relatedFilterLabel({ id, type: 'activity' }, people, undefined)).toBe('This activity')
    expect(relatedFilterLabel({ id, type: 'meal' }, people, 'Lunch 12:30')).toBe('Lunch 12:30')
    expect(relatedFilterLabel({ id, type: 'check_in' }, people, undefined)).toBe('This check-in')
  })
})

describe('relatedFilterLinks', () => {
  test('the filter as one link, none without one', () => {
    const id = '9d0124e7-d161-4855-a54f-fa8bdb45c4f2'
    expect(relatedFilterLinks({ id, type: 'person' }, 'Anna')).toEqual([
      { entity_id: id, entity_type: 'person', label: 'Anna' },
    ])
    expect(relatedFilterLinks(undefined, 'Anyone')).toEqual([])
  })
})

describe('labels in the user zone', () => {
  const instant = new Date('2026-11-20T23:30:00Z')

  test('format the date and time in the given zone, as the server does', () => {
    expect(zonedDate(instant, 'Asia/Tokyo')).toBe('2026-11-21')
    expect(zonedTime(instant, 'Asia/Tokyo')).toBe('08:30')
    expect(zonedTime(new Date('2026-11-20T00:05:00Z'), 'UTC')).toBe('00:05')
    expect(mealLabel({ meal_type: 'breakfast', time: instant }, 'Asia/Tokyo')).toBe('Breakfast 08:30')
    expect(reportLabel({ date: instant, report_type: 'blood_panel' }, 'Asia/Tokyo')).toBe(
      'Blood Panel, 2026-11-21',
    )
    expect(checkInLabel({ answered_at: instant.toISOString(), form_name: 'Morning' }, 'Asia/Tokyo')).toBe(
      'Morning 08:30',
    )
    expect(
      activityLabel(
        { activity_type: 'walking', start_time: instant, title: 'Walk' },
        undefined,
        'Asia/Tokyo',
      ),
    ).toBe('Walk, 2026-11-21')
  })

  test('fall back to the browser zone without one, or with one the browser does not know', () => {
    expect(zonedDate(instant)).toBe(zonedDate(instant, 'Not/AZone'))
    expect(zonedTime(instant)).toBe(zonedTime(instant, 'Not/AZone'))
  })
})
