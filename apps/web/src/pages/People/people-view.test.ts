import type { FollowingActor, ImportantDate, Person } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  birthdayLabel,
  birthdayToForm,
  daysUntil,
  filterPeople,
  followedWithoutProfile,
  formToBirthday,
  formToDateBody,
  importantDateDetail,
  importantDateTitle,
  initialMentions,
  longDate,
  mentionCandidates,
  nameForAccount,
  nextDateByPerson,
  parseNotifyDays,
  relativeDay,
  timeWithHref,
  withPickerOptions,
  yearsPhrase,
} from './people-view'

const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({
  actor: null,
  archived: false,
  birth_date: null,
  birthday_notify_days_before: null,
  created_at: '2026-01-01T00:00:00Z',
  id,
  name,
  pronouns: null,
  relationship: null,
  updated_at: '2026-01-01T00:00:00Z',
  ...extra,
})

const actor = (uri: string, handle: string) => ({ following: false, handle, icon: null, name: null, uri })

const follow = (uri: string, handle: string | null, display_name: string | null = null): FollowingActor => ({
  accepted: true,
  actor_uri: uri,
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  display_name,
  handle,
  id: uri,
  notify_on_post: false,
})

const date = (extra: Partial<ImportantDate>): ImportantDate => ({
  date: '2026-12-01',
  date_id: null,
  kind: 'birthday',
  label: "Anna's birthday",
  person: { id: 'a', name: 'Anna' },
  ...extra,
})

describe('date phrases', () => {
  test('today, tomorrow and in N days', () => {
    expect(relativeDay('2026-11-20', '2026-11-20')).toBe('today')
    expect(relativeDay('2026-11-21', '2026-11-20')).toBe('tomorrow')
    expect(relativeDay('2026-12-02', '2026-11-20')).toBe('in 12 days')
    expect(relativeDay('2026-11-18', '2026-11-20')).toBe('2 days ago')
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1)
  })

  test('a long date names the weekday', () => {
    expect(longDate('2026-12-01')).toBe('Tuesday 1 December')
  })

  test('ages and years since', () => {
    expect(yearsPhrase('birthday', 40)).toBe('turns 40')
    expect(yearsPhrase('anniversary', 15)).toBe('15 years')
    expect(yearsPhrase('remembrance', 1)).toBe('1 year')
    expect(yearsPhrase('anniversary', undefined)).toBe('')
  })

  test('an upcoming date in full', () => {
    expect(importantDateDetail(date({ years: 40 }), '2026-11-20')).toBe(
      'Tuesday 1 December · in 11 days · turns 40',
    )
    expect(importantDateDetail(date({ date: '2026-11-20' }), '2026-11-20')).toBe('Friday 20 November · today')
  })

  test('a birthday keeps its label, another date names the person', () => {
    expect(importantDateTitle(date({}))).toBe("Anna's birthday")
    expect(
      importantDateTitle(date({ date_id: 'd', kind: 'anniversary', label: 'Wedding anniversary' })),
    ).toBe('Anna: Wedding anniversary')
  })

  test('the next date per person is the earliest', () => {
    const next = nextDateByPerson([
      date({ date: '2026-12-10', label: 'later' }),
      date({ date: '2026-12-01', label: 'sooner' }),
      date({ date: '2026-12-05', person: { id: 'b', name: 'Bo' } }),
    ])
    expect(next.get('a')?.label).toBe('sooner')
    expect(next.get('b')?.date).toBe('2026-12-05')
  })
})

describe('birthday input', () => {
  test('reads both forms', () => {
    expect(birthdayToForm('1984-04-12')).toEqual({ day: '12', month: '4', year: '1984' })
    expect(birthdayToForm('--02-29')).toEqual({ day: '29', month: '2', year: '' })
    expect(birthdayToForm(null)).toEqual({ day: '', month: '', year: '' })
  })

  test('writes YYYY-MM-DD or --MM-DD', () => {
    expect(formToBirthday({ day: '12', month: '4', year: '1984' })).toEqual({ value: '1984-04-12' })
    expect(formToBirthday({ day: '3', month: '12', year: '' })).toEqual({ value: '--12-03' })
    expect(formToBirthday({ day: '', month: '', year: '' })).toEqual({ value: null })
  })

  test('refuses half a date and unreal dates', () => {
    expect(formToBirthday({ day: '3', month: '', year: '' })).toHaveProperty('error')
    expect(formToBirthday({ day: '31', month: '4', year: '' })).toHaveProperty('error')
    expect(formToBirthday({ day: '29', month: '2', year: '2023' })).toHaveProperty('error')
    expect(formToBirthday({ day: '29', month: '2', year: '' })).toEqual({ value: '--02-29' })
    expect(formToBirthday({ day: '1', month: '1', year: '84' })).toHaveProperty('error')
  })

  test('labels a birthday', () => {
    expect(birthdayLabel('--12-03')).toBe('3 December')
    expect(birthdayLabel('1984-04-12')).toBe('12 April 1984')
    expect(birthdayLabel(null)).toBe('')
  })
})

describe('date form', () => {
  test('builds a body with an optional year and reminder', () => {
    expect(
      formToDateBody({
        day: '5',
        kind: 'anniversary',
        label: ' Wedding ',
        month: '6',
        notify: '3',
        year: '2011',
      }),
    ).toEqual({
      body: { day: 5, kind: 'anniversary', label: 'Wedding', month: 6, notify_days_before: 3, year: 2011 },
    })
    expect(formToDateBody({ day: '5', kind: 'other', label: 'X', month: '6', notify: '', year: '' })).toEqual(
      {
        body: { day: 5, kind: 'other', label: 'X', month: 6, notify_days_before: null, year: null },
      },
    )
  })

  test('needs a label and a day and month', () => {
    expect(
      formToDateBody({ day: '5', kind: 'other', label: '', month: '6', notify: '', year: '' }),
    ).toHaveProperty('error')
    expect(
      formToDateBody({ day: '', kind: 'other', label: 'X', month: '', notify: '', year: '' }),
    ).toHaveProperty('error')
  })

  test('remind me 0 to 60 days before', () => {
    expect(parseNotifyDays('')).toEqual({ value: null })
    expect(parseNotifyDays('0')).toEqual({ value: 0 })
    expect(parseNotifyDays('61')).toHaveProperty('error')
    expect(parseNotifyDays('-1')).toHaveProperty('error')
  })
})

describe('picker filtering', () => {
  const anna = person('a', 'Anna', {
    actor: actor('https://ex/anna', '@anna@example.social'),
    relationship: 'partner',
  })
  const bo = person('b', 'Bo', { relationship: 'friend' })

  test('filters by name, relationship and handle', () => {
    expect(filterPeople([anna, bo], 'bo').map((p) => p.id)).toEqual(['b'])
    expect(filterPeople([anna, bo], 'PARTNER').map((p) => p.id)).toEqual(['a'])
    expect(filterPeople([anna, bo], 'example.social').map((p) => p.id)).toEqual(['a'])
    expect(filterPeople([anna, bo], ' ')).toHaveLength(2)
  })

  test('offers followed accounts without a profile, leaving out the chosen people', () => {
    const following = [
      follow('https://ex/anna', '@anna@example.social'),
      follow('https://ex/cy', '@cy@example.social', 'Cy'),
      follow('https://ex/tag', null),
    ]
    expect(followedWithoutProfile(following, [anna, bo]).map((f) => f.actor_uri)).toEqual(['https://ex/cy'])
    const options = withPickerOptions([anna, bo], following, ['a'], '')
    expect(options.people.map((p) => p.id)).toEqual(['b'])
    expect(options.accounts.map((f) => f.handle)).toEqual(['@cy@example.social'])
    expect(withPickerOptions([anna, bo], following, [], 'cy').people).toEqual([])
    expect(withPickerOptions([anna, bo], following, [], 'zz').accounts).toEqual([])
  })

  test('names a person from an account', () => {
    expect(nameForAccount({ display_name: 'Cy Lee', handle: '@cy@ex' })).toBe('Cy Lee')
    expect(nameForAccount({ display_name: null, handle: '@cy@ex' })).toBe('cy')
  })
})

describe('mentions', () => {
  const anna = person('a', 'Anna', { actor: actor('https://ex/anna', '@anna@example.social') })
  const bo = person('b', 'Bo')

  test('only linked people with a handle can be mentioned', () => {
    expect(mentionCandidates([{ id: 'a' }, { id: 'b' }, { id: 'gone' }], [anna, bo])).toEqual([
      { actor_uri: 'https://ex/anna', handle: '@anna@example.social', id: 'a', name: 'Anna' },
    ])
    expect(mentionCandidates(undefined, [anna])).toEqual([])
  })

  test('the switches start off on a fresh share, even when an earlier post mentioned them', () => {
    const candidates = mentionCandidates([{ id: 'a' }], [anna])
    const mentions = [{ actor_uri: 'https://ex/anna', handle: '@anna@example.social' }]
    expect(initialMentions(candidates, mentions, false)).toEqual([])
    expect(initialMentions(candidates, mentions, true)).toEqual(['a'])
    expect(initialMentions(candidates, undefined, true)).toEqual([])
  })
})

test('the Analyze link preselects the time with the person', () => {
  expect(timeWithHref('abc')).toBe('/correlations?tab=explore&mode=continuous&trigger=people:abc')
})
