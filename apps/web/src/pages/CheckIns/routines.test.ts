import type { CheckInForm, CheckInQuestion } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { answerProblems, draftsToAnswers } from './answers'
import {
  adherenceCells,
  answersLine,
  asNeededRoutines,
  canLeaveOut,
  hasSlots,
  isTakenAnswer,
  itemCounts,
  presetLine,
  routineDraft,
  routineDrafts,
  routineItems,
  unloggedKeys,
} from './routines'

const vitaminD: CheckInQuestion = {
  default: 50,
  key: 'vitamin_d',
  logs_to: { activity_type: 'supplement', answer_field: 'dose', fields: { substance: 'vitamin D' } },
  min: 0,
  prompt: 'Vitamin D',
  required: false,
  type: 'number',
  unit: 'µg',
}

const magnesium: CheckInQuestion = {
  default: 200,
  key: 'magnesium',
  logs_to: { metric: 'magnesium_mg' },
  min: 0,
  prompt: 'Magnesium',
  required: true,
  type: 'number',
  unit: 'mg',
}

const stretched: CheckInQuestion = {
  default: true,
  key: 'stretch',
  prompt: 'Stretched',
  required: true,
  type: 'yes_no',
}

const note: CheckInQuestion = { key: 'note', prompt: 'Note', required: false, type: 'text' }

const form = (patch: Partial<CheckInForm>): CheckInForm => ({
  archived: false,
  created_at: '2026-11-01T08:00:00.000Z',
  deleted_at: null,
  description: null,
  id: '00000000-0000-4000-8000-000000000001',
  is_routine: true,
  name: 'Ibuprofen',
  notify: true,
  questions: [{ ...vitaminD, default: 400, prompt: 'Ibuprofen', unit: 'mg' }],
  schedule: null,
  score: null,
  updated_at: '2026-11-01T08:00:00.000Z',
  version: 1,
  ...patch,
})

describe('presetLine', () => {
  test('lists the preset items like the notification does, leaving out 0 and no', () => {
    expect(
      presetLine([vitaminD, magnesium, stretched, { ...stretched, default: false, key: 'other' }, note]),
    ).toBe('Vitamin D 50 µg, Magnesium 200 mg, Stretched')
    expect(presetLine([{ ...vitaminD, default: 0 }])).toBe('')
  })

  test('answersLine reads given answers the same way', () => {
    expect(answersLine([vitaminD, magnesium], { magnesium: 150, vitamin_d: 0 })).toBe('Magnesium 150 mg')
  })
})

describe('isTakenAnswer', () => {
  test('0, no and blanks are not taken', () => {
    expect(isTakenAnswer(vitaminD, 0)).toBe(false)
    expect(isTakenAnswer(stretched, false)).toBe(false)
    expect(isTakenAnswer(note, '  ')).toBe(false)
    expect(isTakenAnswer(vitaminD, 25)).toBe(true)
  })
})

describe('asNeededRoutines', () => {
  test('keeps live routines without a schedule', () => {
    const schedule = { day_starts_at: '04:00', times: ['08:00'], weekdays: [1, 2, 3, 4, 5, 6, 7] }
    const forms = [
      form({ id: 'a' }),
      form({ id: 'b', schedule }),
      form({ id: 'c', is_routine: false }),
      form({ archived: true, id: 'd' }),
      form({ deleted_at: '2026-11-02T00:00:00.000Z', id: 'e' }),
    ]
    expect(asNeededRoutines(forms).map((f) => f.id)).toEqual(['a'])
  })
})

describe('routine drafts', () => {
  const questions = [vitaminD, magnesium, stretched, note]

  test('the items are the questions with a preset, each starting at it', () => {
    expect(routineItems(questions).map((q) => q.key)).toEqual(['vitamin_d', 'magnesium', 'stretch'])
    expect(routineDraft(questions).drafts).toEqual({ magnesium: '200', stretch: true, vitamin_d: '50' })
  })

  test('everything ticked saves the presets, with a changed dose', () => {
    const draft = routineDraft(questions)
    const drafts = routineDrafts(questions, { ...draft, drafts: { ...draft.drafts, magnesium: '300' } })
    expect(draftsToAnswers(questions, drafts)).toEqual({ magnesium: 300, stretch: true, vitamin_d: 50 })
  })

  test('an item left out is no answer, or 0 / no when required', () => {
    const drafts = routineDrafts(questions, {
      ...routineDraft(questions),
      left_out: ['vitamin_d', 'magnesium', 'stretch'],
    })
    expect(draftsToAnswers(questions, drafts)).toEqual({ magnesium: 0, stretch: false })
    expect(answerProblems(questions, drafts)).toEqual([])
  })

  test('a required item without a "not taken" answer cannot be left out', () => {
    expect(canLeaveOut(vitaminD)).toBe(true)
    expect(canLeaveOut(magnesium)).toBe(true)
    expect(canLeaveOut(stretched)).toBe(true)
    expect(canLeaveOut({ ...magnesium, min: 1 })).toBe(false)
    expect(canLeaveOut({ ...note, default: 'x', required: true })).toBe(false)
  })
})

describe('adherence', () => {
  const day = (
    date: string,
    counts: Partial<Record<'done' | 'skipped' | 'missed' | 'upcoming', number>>,
  ) => ({
    date,
    done: 0,
    missed: 0,
    skipped: 0,
    upcoming: 0,
    ...counts,
  })

  test('each day becomes a cell of its slots, done first, with a label', () => {
    expect(
      adherenceCells([
        day('2026-11-19', { done: 1, missed: 1 }),
        day('2026-11-20', { skipped: 1, upcoming: 1 }),
      ]),
    ).toEqual([
      { date: '2026-11-19', label: 'Thu 19 Nov: 1 done, 1 missed', slots: ['done', 'missed'] },
      { date: '2026-11-20', label: 'Fri 20 Nov: 1 skipped, 1 upcoming', slots: ['skipped', 'upcoming'] },
    ])
    expect(adherenceCells([day('2026-11-18', {})])[0]).toEqual({
      date: '2026-11-18',
      label: 'Wed 18 Nov: no slots',
      slots: [],
    })
  })

  test('hasSlots is false for a form without a schedule', () => {
    expect(hasSlots({ totals: { done: 0, missed: 0, skipped: 0, upcoming: 0 } })).toBe(false)
    expect(hasSlots({ totals: { done: 0, missed: 1, skipped: 0, upcoming: 0 } })).toBe(true)
  })

  test('itemCounts tells how often each item was taken', () => {
    expect(
      itemCounts({
        answered_check_ins: 4,
        questions: [
          { answered: 4, key: 'vitamin_d', prompt: 'Vitamin D' },
          { answered: 1, key: 'magnesium', prompt: 'Magnesium' },
        ],
      }),
    ).toEqual([
      { key: 'vitamin_d', line: '4 of 4', prompt: 'Vitamin D', share: 1 },
      { key: 'magnesium', line: '1 of 4', prompt: 'Magnesium', share: 0.25 },
    ])
    expect(
      itemCounts({ answered_check_ins: 0, questions: [{ answered: 0, key: 'a', prompt: 'A' }] })[0].share,
    ).toBe(0)
  })
})

describe('unloggedKeys', () => {
  test('names the answers whose activity was deleted on its own', () => {
    expect(
      unloggedKeys({
        activities: {
          magnesium: { activity_id: '00000000-0000-4000-8000-000000000002', logged: true },
          vitamin_d: { activity_id: '00000000-0000-4000-8000-000000000003', logged: false },
        },
      }),
    ).toEqual(new Set(['vitamin_d']))
  })
})
