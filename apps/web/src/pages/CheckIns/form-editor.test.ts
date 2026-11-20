import type { CheckInForm } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  buildForm,
  canLog,
  changeType,
  draftFromForm,
  emptyFormDraft,
  type FormDraft,
  keyFromText,
  moveQuestion,
  newQuestion,
  type QuestionDraft,
  startsNewVersion,
  toAddBody,
  toUpdateBody,
} from './form-editor'

const question = (patch: Partial<QuestionDraft>): QuestionDraft => ({ ...newQuestion('scale'), ...patch })

const draft = (patch: Partial<FormDraft>): FormDraft => ({ ...emptyFormDraft(), name: 'Morning', ...patch })

const savedForm: CheckInForm = {
  archived: false,
  created_at: '2026-11-01T08:00:00.000Z',
  deleted_at: null,
  description: null,
  id: '00000000-0000-4000-8000-000000000001',
  is_routine: false,
  name: 'Morning',
  notify: true,
  questions: [
    {
      key: 'rested',
      logs_to: { metric: 'rested' },
      max: 5,
      min: 1,
      prompt: 'How rested?',
      required: true,
      type: 'scale',
    },
    { key: 'note', prompt: 'Anything else?', required: false, type: 'text' },
  ],
  schedule: { day_starts_at: '04:00', times: ['08:00'], weekdays: [1, 2, 3, 4, 5, 6, 7] },
  score: null,
  updated_at: '2026-11-01T08:00:00.000Z',
  version: 1,
}

describe('keyFromText', () => {
  test('lowercases, drops accents and joins words with underscores', () => {
    expect(keyFromText('How rested do you feel?', new Set())).toBe('how_rested_do_you_feel')
    expect(keyFromText('Ångest & oro', new Set())).toBe('angest_oro')
  })

  test('starts with a letter and fits 40 characters', () => {
    expect(keyFromText('3 cups', new Set())).toBe('question_3_cups')
    expect(keyFromText('?!', new Set())).toBe('question')
    expect(keyFromText('a'.repeat(60), new Set())).toHaveLength(40)
  })

  test('is unique among the keys taken', () => {
    expect(keyFromText('Mood', new Set(['mood']))).toBe('mood_2')
    expect(keyFromText('Mood', new Set(['mood', 'mood_2']))).toBe('mood_3')
  })
})

describe('canLog', () => {
  test('numbers, scales, yes/no and a choice with every value', () => {
    expect(canLog(newQuestion('number'))).toBe(true)
    expect(canLog(newQuestion('yes_no'))).toBe(true)
    expect(canLog(newQuestion('text'))).toBe(false)
    expect(canLog(newQuestion('multi_choice'))).toBe(false)
    const choice = newQuestion('choice')
    expect(canLog(choice)).toBe(false)
    expect(
      canLog({
        ...choice,
        options: [
          { key: null, label: 'Low', value: '1' },
          { key: null, label: 'High', value: '2' },
        ],
      }),
    ).toBe(true)
  })
})

describe('changeType', () => {
  test('a scale gets its default ends and a text stops logging', () => {
    const scale = changeType(newQuestion('text'), 'scale')
    expect([scale.min, scale.max]).toEqual(['1', '5'])
    const text = changeType({ ...newQuestion('scale'), logs: true, metric: 'x' }, 'text')
    expect(text.logs).toBe(false)
  })
})

describe('moveQuestion', () => {
  test('swaps with the neighbour and stays put at the ends', () => {
    const a = question({ prompt: 'a' })
    const b = question({ prompt: 'b' })
    expect(moveQuestion([a, b], 0, 1).map((q) => q.prompt)).toEqual(['b', 'a'])
    expect(moveQuestion([a, b], 0, -1).map((q) => q.prompt)).toEqual(['a', 'b'])
  })
})

describe('buildForm', () => {
  test('derives keys from prompts and option labels', () => {
    const result = buildForm(
      draft({
        questions: [
          question({ prompt: 'How rested?' }),
          question({
            options: [
              { key: null, label: 'Coffee', value: '' },
              { key: null, label: 'Tea', value: '' },
            ],
            prompt: 'Drinks',
            type: 'multi_choice',
          }),
        ],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.questions.map((q) => q.key)).toEqual(['how_rested', 'drinks'])
    const drinks = result.value.questions[1]
    expect(drinks.type === 'multi_choice' && drinks.options.map((o) => o.key)).toEqual(['coffee', 'tea'])
  })

  test('keeps saved keys', () => {
    const result = buildForm({ ...draftFromForm(savedForm), questions: draftFromForm(savedForm).questions })
    expect(result.ok && result.value.questions.map((q) => q.key)).toEqual(['rested', 'note'])
  })

  test('names every problem', () => {
    const result = buildForm(
      draft({
        name: ' ',
        questions: [question({ logs: true, max: '20', metric: 'Bad Name', prompt: '' })],
        schedule_on: true,
        weekdays: [],
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual([
      'Give the form a name.',
      'Question 1: write the question.',
      'Question 1: the metric name must be lowercase letters, digits and underscores, starting with a letter.',
      'Question 1: a scale has at most 11 points.',
      'Schedule: pick at least one day.',
    ])
  })

  test('refuses a metric logged twice, through the shared check', () => {
    const result = buildForm(
      draft({
        questions: [
          question({ logs: true, metric: 'mood', prompt: 'Mood' }),
          question({ logs: true, metric: 'mood', prompt: 'Mood later' }),
        ],
      }),
    )
    expect(result.ok ? [] : result.errors).toEqual(['Metric "mood" is logged twice by this form.'])
  })

  test('builds the score and the schedule', () => {
    const rested = question({ prompt: 'Rested' })
    const mood = question({ prompt: 'Mood' })
    const result = buildForm(
      draft({
        day_starts_at: '03:58',
        end_date: '2026-12-31',
        questions: [rested, mood],
        schedule_on: true,
        score_factor: '4',
        score_metric: 'wellbeing',
        score_on: true,
        score_questions: [rested.id, mood.id],
        times: ['21:00', '08:02'],
        weekdays: [5, 1],
      }),
    )
    expect(result.ok && result.value.score).toEqual({
      factor: 4,
      metric: 'wellbeing',
      questions: ['rested', 'mood'],
    })
    expect(result.ok && result.value.schedule).toEqual({
      day_starts_at: '04:00',
      end_date: '2026-12-31',
      times: ['08:00', '21:00'],
      weekdays: [1, 5],
    })
  })
})

describe('bodies', () => {
  test('an add leaves out what is empty', () => {
    const result = buildForm(draft({ questions: [question({ prompt: 'Rested' })] }))
    if (!result.ok) throw new Error(result.errors.join())
    expect(toAddBody(result.value)).toEqual({
      name: 'Morning',
      notify: true,
      questions: [{ key: 'rested', max: 5, min: 1, prompt: 'Rested', required: false, type: 'scale' }],
    })
  })

  test('an update sends only what changed', () => {
    const unchanged = buildForm(draftFromForm(savedForm))
    if (!unchanged.ok) throw new Error(unchanged.errors.join())
    expect(toUpdateBody(savedForm, unchanged.value)).toEqual({})
    const renamed = buildForm({
      ...draftFromForm(savedForm),
      description: 'Daily',
      name: 'Mornings',
      schedule_on: false,
    })
    if (!renamed.ok) throw new Error(renamed.errors.join())
    expect(toUpdateBody(savedForm, renamed.value)).toEqual({
      description: 'Daily',
      name: 'Mornings',
      schedule: null,
    })
  })
})

describe('startsNewVersion', () => {
  test('a reorder or rename keeps the version; a changed prompt does not', () => {
    const reversed = { questions: [...savedForm.questions].reverse(), score: null }
    expect(startsNewVersion(savedForm, reversed)).toBe(false)
    const changed = {
      questions: [{ ...savedForm.questions[0], prompt: 'How rested are you?' }, savedForm.questions[1]],
      score: null,
    }
    expect(startsNewVersion(savedForm, changed)).toBe(true)
    expect(
      startsNewVersion(savedForm, {
        questions: savedForm.questions,
        score: { metric: 's', questions: ['rested'] },
      }),
    ).toBe(true)
  })
})
