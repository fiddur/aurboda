import type { CheckIn, CheckInForm, CheckInQuestion, DueSlot } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  answeredLine,
  checkInScheduleLine,
  checkInSeries,
  fillHref,
  formatAnswer,
  latestByForm,
  openSlots,
  showsDueCard,
  slotLabel,
  whenLine,
} from './check-in-view'

const rested: CheckInQuestion = {
  key: 'rested',
  logs_to: { metric: 'rested' },
  max: 5,
  min: 1,
  prompt: 'How rested?',
  required: true,
  type: 'scale',
}

const form: CheckInForm = {
  archived: false,
  created_at: '2026-11-01T08:00:00.000Z',
  deleted_at: null,
  description: null,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Morning',
  notify: true,
  questions: [{ key: 'note', prompt: 'Note', required: false, type: 'text' }, rested],
  schedule: null,
  score: null,
  updated_at: '2026-11-01T08:00:00.000Z',
  version: 2,
}

const checkIn = (patch: Partial<CheckIn>): CheckIn => ({
  answered_at: '2026-11-20T07:12:00.000Z',
  answers: {},
  created_at: '2026-11-20T07:12:00.000Z',
  deleted_at: null,
  form_id: form.id,
  form_name: form.name,
  form_version: 1,
  id: '00000000-0000-4000-8000-000000000010',
  logged: {},
  note: null,
  questions: [rested],
  scheduled_for: null,
  score: null,
  status: 'answered',
  updated_at: '2026-11-20T07:12:00.000Z',
  ...patch,
})

describe('checkInScheduleLine', () => {
  test('says the days, the times and the dates', () => {
    expect(
      checkInScheduleLine({
        day_starts_at: '04:00',
        times: ['21:00', '08:00'],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      }),
    ).toBe('Every day at 08:00 and 21:00')
    expect(
      checkInScheduleLine({
        day_starts_at: '04:00',
        start_date: '2026-12-01',
        times: ['07:30'],
        weekdays: [1, 2, 3, 4, 5],
      }),
    ).toBe('Weekdays at 07:30, from 2026-12-01')
    expect(
      checkInScheduleLine({
        day_starts_at: '04:00',
        end_date: '2027-01-31',
        times: ['07:30'],
        weekdays: [6, 7],
      }),
    ).toBe('Weekends at 07:30, until 2027-01-31')
  })
})

describe('slotLabel', () => {
  test('one line per state', () => {
    expect(slotLabel({ state: 'due', time: '08:00' })).toBe('Due now')
    expect(slotLabel({ state: 'upcoming', time: '21:00' })).toBe('Later today at 21:00')
    expect(slotLabel({ state: 'done', time: '08:00' })).toBe('Done')
    expect(slotLabel({ state: 'missed', time: '08:00' })).toBe('Missed')
  })
})

describe('fillHref', () => {
  test('carries the slot when there is one', () => {
    expect(fillHref('f1')).toBe('/check-ins/f1')
    expect(fillHref('f1', '2026-11-20T07:00:00.000Z')).toBe('/check-ins/f1?slot=2026-11-20T07%3A00%3A00.000Z')
  })
})

describe('whenLine and answeredLine', () => {
  const now = new Date(2026, 10, 20, 12, 0)
  test('today, yesterday, this year and before', () => {
    expect(whenLine(new Date(2026, 10, 20, 8, 12), now)).toBe('today 08:12')
    expect(whenLine(new Date(2026, 10, 19, 21, 3), now)).toBe('yesterday 21:03')
    expect(whenLine(new Date(2026, 10, 3, 8, 12), now)).toBe('3 Nov 08:12')
    expect(whenLine(new Date(2025, 10, 3, 8, 12), now)).toBe('3 Nov 2025 08:12')
  })

  test('adds the score when there is one', () => {
    const at = new Date(2026, 10, 20, 8, 12).toISOString()
    expect(answeredLine({ answered_at: at, score: null }, now)).toBe('Answered today 08:12')
    expect(answeredLine({ answered_at: at, score: 14 }, now)).toBe('Answered today 08:12, score 14')
  })
})

describe('latestByForm', () => {
  test('keeps the first, newest, of each form', () => {
    const newest = checkIn({ id: '00000000-0000-4000-8000-000000000011' })
    const older = checkIn({ answered_at: '2026-11-19T07:00:00.000Z' })
    expect(latestByForm([newest, older]).get(form.id)?.id).toBe(newest.id)
  })
})

describe('formatAnswer', () => {
  test('reads each type in words', () => {
    expect(formatAnswer(rested, 4)).toBe('4 of 1–5')
    expect(formatAnswer({ key: 'c', prompt: 'c', required: false, type: 'number', unit: 'mg' }, 2.5)).toBe(
      '2.5 mg',
    )
    expect(formatAnswer({ key: 'p', prompt: 'p', required: false, type: 'yes_no' }, false)).toBe('No')
    const options = [
      { key: 'a', label: 'Alpha' },
      { key: 'b', label: 'Beta' },
    ]
    expect(
      formatAnswer({ key: 'm', options, prompt: 'm', required: false, type: 'multi_choice' }, ['a', 'b']),
    ).toBe('Alpha, Beta')
    expect(formatAnswer(rested, undefined)).toBe('—')
  })
})

describe('checkInSeries', () => {
  test('charts the first logged question, oldest first, read against the version answered', () => {
    const series = checkInSeries(form, [
      checkIn({ answered_at: '2026-11-20T07:00:00.000Z', answers: { rested: 4 } }),
      checkIn({ answered_at: '2026-11-19T07:00:00.000Z', answers: { rested: 2 } }),
      checkIn({ answered_at: '2026-11-18T07:00:00.000Z', answers: {} }),
    ])
    expect(series).toEqual({
      label: 'How rested?',
      metric: 'rested',
      points: [
        { date: '2026-11-19T07:00:00.000Z', value: 2 },
        { date: '2026-11-20T07:00:00.000Z', value: 4 },
      ],
    })
  })

  test('charts the score when the form has one, and nothing without either', () => {
    const scored = { ...form, score: { metric: 'wellbeing', questions: ['rested'] } }
    expect(checkInSeries(scored, [checkIn({ score: 12 })])?.points).toEqual([
      { date: '2026-11-20T07:12:00.000Z', value: 12 },
    ])
    expect(checkInSeries({ ...form, questions: [form.questions[0]] }, [])).toBeNull()
  })
})

describe('showsDueCard and openSlots', () => {
  const schedule = { day_starts_at: '04:00', times: ['08:00'], weekdays: [1, 2, 3, 4, 5, 6, 7] }

  test('needs a live scheduled form and the page in the menu', () => {
    expect(showsDueCard([{ ...form, schedule }], false)).toBe(true)
    expect(showsDueCard([{ ...form, schedule }], true)).toBe(false)
    expect(showsDueCard([form], false)).toBe(false)
    expect(showsDueCard([{ ...form, archived: true, schedule }], false)).toBe(false)
  })

  test('lists due slots before upcoming ones and leaves out the rest', () => {
    const slot = (state: DueSlot['state'], time: string): DueSlot => ({
      check_in_id: null,
      date: '2026-11-20',
      form_id: form.id,
      form_name: form.name,
      scheduled_for: `2026-11-20T${time}:00.000Z`,
      state,
      time,
    })
    expect(
      openSlots([
        slot('done', '07:00'),
        slot('upcoming', '21:00'),
        slot('due', '12:00'),
        slot('missed', '06:00'),
      ]).map((s) => s.time),
    ).toEqual(['12:00', '21:00'])
  })
})
