import type { CheckInForm } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  buildForm,
  canLog,
  changeType,
  draftFromForm,
  draftIsRoutine,
  emptyFormDraft,
  emptyIntakeDraft,
  type FormDraft,
  intakeProblems,
  intakeQuestion,
  isBlankQuestion,
  keyFromText,
  metricNameForDose,
  moveQuestion,
  newQuestion,
  presetTicks,
  presetWithin,
  type QuestionDraft,
  startsNewVersion,
  toAddBody,
  togglePresetOption,
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

describe('draftIsRoutine', () => {
  test('every required question has a preset, and at least one does', () => {
    expect(draftIsRoutine([question({ preset: '5' }), question({})])).toBe(true)
    expect(draftIsRoutine([question({ preset: '5' }), question({ required: true })])).toBe(false)
    expect(draftIsRoutine([question({})])).toBe(false)
    expect(draftIsRoutine([question({ preset: ' ', required: true })])).toBe(false)
  })
})

describe('preset answers', () => {
  const routineForm: CheckInForm = {
    ...savedForm,
    is_routine: true,
    questions: [
      {
        default: 50,
        key: 'vitamin_d',
        logs_to: {
          activity_type: 'supplement',
          answer_field: 'dose',
          fields: { dose_unit: 'µg', substance: 'vitamin D' },
        },
        min: 0,
        prompt: 'Vitamin D',
        required: false,
        type: 'number',
        unit: 'µg',
      },
      { default: true, key: 'stretch', prompt: 'Stretched', required: false, type: 'yes_no' },
      {
        default: 'b',
        key: 'pick',
        options: [
          { key: 'a', label: 'A' },
          { key: 'b', label: 'B' },
        ],
        prompt: 'Pick',
        required: false,
        type: 'choice',
      },
    ],
    schedule: null,
  }

  test('a saved routine round-trips through the draft unchanged', () => {
    const loaded = draftFromForm(routineForm)
    expect(loaded.questions.map((q) => q.preset)).toEqual(['50', 'yes', '1'])
    expect(loaded.questions[0]).toMatchObject({
      activity_type: 'supplement',
      answer_field: 'dose',
      log_as: 'activity',
      logs: true,
    })
    const built = buildForm(loaded)
    expect(built.ok && toUpdateBody(routineForm, built.value)).toEqual({})
  })

  test('a preset outside the range is refused in words', () => {
    const built = buildForm(draft({ questions: [question({ preset: '9', prompt: 'Rested' })] }))
    expect(built.ok).toBe(false)
    expect(!built.ok && built.errors).toEqual([
      'Question 1: the preset answer must be a whole number from 1 to 5.',
    ])
  })

  test('an activity log needs a type; empty fields and the answer field are left out of fields', () => {
    const missing = buildForm(
      draft({ questions: [question({ log_as: 'activity', logs: true, prompt: 'Rested' })] }),
    )
    expect(!missing.ok && missing.errors).toEqual([
      'Question 1: pick the activity type to save the answer as.',
    ])
    const built = buildForm(
      draft({
        questions: [
          question({
            activity_fields: [
              { kind: 'string', name: 'substance', value: 'zinc' },
              { kind: 'number', name: 'dose', value: '3' },
              { kind: 'string', name: 'note', value: ' ' },
            ],
            activity_type: 'supplement',
            answer_field: 'dose',
            log_as: 'activity',
            logs: true,
            prompt: 'Zinc',
            type: 'number',
          }),
        ],
      }),
    )
    expect(built.ok && built.value.questions[0].logs_to).toEqual({
      activity_type: 'supplement',
      answer_field: 'dose',
      fields: { substance: 'zinc' },
    })
  })
})

describe('the medication or supplement shortcut', () => {
  test('metricNameForDose makes a metric name from substance and unit', () => {
    expect(metricNameForDose('Ibuprofen', 'mg')).toBe('ibuprofen_mg')
    expect(metricNameForDose('Vitamin D', 'µg')).toBe('vitamin_d_ug')
    expect(metricNameForDose('Omega-3 (EPA)', 'mg')).toBe('omega_3_epa_mg')
    expect(metricNameForDose('5-HTP', 'mg')).toBe('dose_5_htp_mg')
    expect(metricNameForDose('x'.repeat(60), 'mg')).toHaveLength(50)
  })

  test('says what is missing', () => {
    expect(intakeProblems(emptyIntakeDraft())).toEqual([
      'Name the medication or supplement.',
      'Give the dose as a number above 0.',
    ])
  })

  test('as a metric: a number question preset to the dose, logged to the dose metric', () => {
    const made = intakeQuestion({
      dose: '400',
      kind: 'medication',
      log_as: 'metric',
      substance: 'ibuprofen',
      unit: 'mg',
    })
    const built = buildForm(draft({ questions: [made] }))
    expect(built.ok && built.value.questions[0]).toEqual({
      default: 400,
      key: 'ibuprofen',
      logs_to: { metric: 'ibuprofen_mg' },
      min: 0,
      prompt: 'Ibuprofen',
      required: false,
      type: 'number',
      unit: 'mg',
    })
  })

  test('as an activity: the medication or supplement type with substance and unit fixed', () => {
    const made = intakeQuestion({
      dose: '50',
      kind: 'supplement',
      log_as: 'activity',
      substance: 'Vitamin D',
      unit: 'µg',
    })
    const built = buildForm(draft({ questions: [made] }))
    expect(built.ok && built.value.questions[0]).toMatchObject({
      default: 50,
      logs_to: {
        activity_type: 'supplement',
        answer_field: 'dose',
        fields: { dose_unit: 'µg', substance: 'Vitamin D' },
      },
      unit: 'µg',
    })
    expect(draftIsRoutine([made])).toBe(true)
  })

  test('replaces the untouched question a new form starts with', () => {
    expect(isBlankQuestion(newQuestion('scale'))).toBe(true)
    expect(isBlankQuestion({ ...newQuestion('scale'), prompt: 'Mood' })).toBe(false)
  })
})

describe('a multi-choice preset', () => {
  const drinks = question({
    options: [
      { key: null, label: 'Coffee', value: '' },
      { key: null, label: 'Tea', value: '' },
      { key: null, label: 'Water', value: '' },
    ],
    prompt: 'Drinks',
    type: 'multi_choice',
  })

  test('ticks and unticks options, in option order', () => {
    const ticked = togglePresetOption(togglePresetOption('', 2, true), 0, true)
    expect(ticked).toBe('0,2')
    expect(presetTicks(ticked, 2)).toBe(true)
    expect(presetTicks(ticked, 1)).toBe(false)
    expect(togglePresetOption(ticked, 2, false)).toBe('0')
    expect(togglePresetOption('0', 0, false)).toBe('')
  })

  test('keeps only the options still there when they change', () => {
    expect(presetWithin('0,2', 2)).toBe('0')
    expect(presetWithin('1', 2)).toBe('1')
    expect(presetWithin('', 2)).toBe('')
  })

  test('saves the ticked option keys as the default, and none when nothing is ticked', () => {
    const withPreset = buildForm(draft({ questions: [{ ...drinks, preset: '0,2' }] }))
    expect(withPreset.ok && withPreset.value.questions[0]!.default).toEqual(['coffee', 'water'])
    const without = buildForm(draft({ questions: [drinks] }))
    expect(without.ok && 'default' in without.value.questions[0]!).toBe(false)
  })

  test('a saved multi-choice preset round-trips through the draft', () => {
    const form: CheckInForm = {
      ...savedForm,
      questions: [
        {
          default: ['tea'],
          key: 'drinks',
          options: [
            { key: 'coffee', label: 'Coffee' },
            { key: 'tea', label: 'Tea' },
          ],
          prompt: 'Drinks',
          required: false,
          type: 'multi_choice',
        },
      ],
    }
    const loaded = draftFromForm(form)
    expect(loaded.questions[0]!.preset).toBe('1')
    const built = buildForm(loaded)
    expect(built.ok && toUpdateBody(form, built.value)).toEqual({})
  })
})
