import {
  addCheckInFormBodySchema,
  type CheckInQuestion,
  checkInFormProblems,
  checkInsQuerySchema,
  isCheckInRoutine,
  isTakenAnswer,
  presetItem,
  presetLine,
  scheduleSchema,
  submitCheckInBodySchema,
  updateCheckInBodySchema,
  updateCheckInFormBodySchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

const scale = { key: 'rested', max: 5, min: 1, prompt: 'How rested?', type: 'scale' }

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? []

describe('scheduleSchema', () => {
  test('fills the defaults', () => {
    expect(scheduleSchema.parse({ times: ['08:00'] })).toEqual({
      day_starts_at: '04:00',
      times: ['08:00'],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    })
  })

  test.each([
    [{ times: [] }],
    [{ times: ['08:03'] }],
    [{ times: ['08:00', '08:00'] }],
    [{ times: Array.from({ length: 13 }, (_, i) => `${String(i + 10)}:00`) }],
    [{ day_starts_at: '04:01', times: ['08:00'] }],
    [{ times: ['08:00'], weekdays: [0] }],
    [{ end_date: '2026-01-01', start_date: '2026-02-01', times: ['08:00'] }],
  ])('refuses %j', (schedule) => {
    expect(scheduleSchema.safeParse(schedule).success).toBe(false)
  })
})

describe('addCheckInFormBodySchema', () => {
  test('accepts a form and defaults required to false and notify to true', () => {
    const parsed = addCheckInFormBodySchema.parse({ name: 'Morning', questions: [scale] })
    expect(parsed.notify).toBe(true)
    expect(parsed.questions?.[0]?.required).toBe(false)
  })

  test('accepts a template alone', () => {
    expect(addCheckInFormBodySchema.safeParse({ template: 'morning' }).success).toBe(true)
  })

  test('needs a name and questions without a template', () => {
    expect(messages(addCheckInFormBodySchema.safeParse({}))).toEqual([
      'Give a name or a template',
      'Give questions or a template',
    ])
  })

  test.each([
    [{ ...scale, key: 'Rested' }, 'Must be lowercase'],
    [{ ...scale, key: `a${'b'.repeat(40)}` }, 'Must be lowercase'],
    [{ ...scale, prompt: '' }, ''],
    [{ ...scale, max: 1 }, 'max must be above min'],
    [{ ...scale, max: 11, min: 0 }, 'at most 11 points'],
    [{ ...scale, max: 4.5 }, ''],
    [{ key: 'n', max: 1, min: 2, prompt: 'N', type: 'number' }, 'max must be above min'],
    [{ key: 'c', options: [{ key: 'a', label: 'A' }], prompt: 'C', type: 'choice' }, ''],
    [
      {
        key: 'c',
        options: [
          { key: 'a', label: 'A' },
          { key: 'a', label: 'B' },
        ],
        prompt: 'C',
        type: 'choice',
      },
      'Option keys must be unique',
    ],
    [{ key: 't', logs_to: { metric: 'x' }, prompt: 'T', type: 'text' }, 'cannot be logged'],
    [
      {
        key: 'c',
        logs_to: { metric: 'x' },
        options: [
          { key: 'a', label: 'A', value: 1 },
          { key: 'b', label: 'B' },
        ],
        prompt: 'C',
        type: 'choice',
      },
      'numeric value on every option',
    ],
    [{ ...scale, logs_to: { metric: 'Bad Name' } }, 'Must be lowercase'],
  ])('refuses the question %j', (question, message) => {
    const result = addCheckInFormBodySchema.safeParse({ name: 'F', questions: [question] })
    expect(result.success).toBe(false)
    expect(messages(result).join()).toContain(message)
  })

  test('refuses more than 40 questions', () => {
    const questions = Array.from({ length: 41 }, (_, i) => ({ ...scale, key: `q${i}` }))
    expect(addCheckInFormBodySchema.safeParse({ name: 'F', questions }).success).toBe(false)
  })

  test('refuses duplicate keys, a metric logged twice, and a score over missing or non-numeric questions', () => {
    const result = addCheckInFormBodySchema.safeParse({
      name: 'F',
      questions: [
        { ...scale, logs_to: { metric: 'm' } },
        { ...scale, logs_to: { metric: 'm' } },
        { key: 'notes', prompt: 'Notes', type: 'text' },
      ],
      score: { metric: 'total', questions: ['notes', 'gone'] },
    })
    expect(messages(result)).toEqual([
      'Duplicate question key "rested"',
      'Metric "m" is logged twice by this form',
      'Question "notes" has no numeric answer to score',
      'No question "gone"',
    ])
  })
})

describe('checkInFormProblems', () => {
  test('is empty for a good form', () => {
    expect(
      checkInFormProblems([{ ...scale, required: false, type: 'scale' }], {
        metric: 'total',
        questions: ['rested'],
      }),
    ).toEqual([])
  })
})

describe('updateCheckInFormBodySchema', () => {
  test('needs at least one field, and takes null to clear', () => {
    expect(updateCheckInFormBodySchema.safeParse({}).success).toBe(false)
    expect(updateCheckInFormBodySchema.parse({ schedule: null, score: null })).toEqual({
      schedule: null,
      score: null,
    })
  })
})

describe('submitCheckInBodySchema', () => {
  test('takes answers of every kind and defaults them to none', () => {
    expect(
      submitCheckInBodySchema.parse({
        answers: { a: 1, b: true, c: 'ok', d: ['x', 'y'] },
        form_id: '11111111-1111-4111-8111-111111111111',
      }).answers,
    ).toEqual({ a: 1, b: true, c: 'ok', d: ['x', 'y'] })
    expect(
      submitCheckInBodySchema.parse({ form_id: '11111111-1111-4111-8111-111111111111' }).answers,
    ).toEqual({})
  })

  test('refuses a bad form id and a null answer', () => {
    expect(submitCheckInBodySchema.safeParse({ form_id: 'nope' }).success).toBe(false)
    expect(
      submitCheckInBodySchema.safeParse({
        answers: { a: null },
        form_id: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false)
  })
})

describe('updateCheckInBodySchema', () => {
  test('needs at least one field', () => {
    expect(updateCheckInBodySchema.safeParse({}).success).toBe(false)
    expect(updateCheckInBodySchema.safeParse({ note: null }).success).toBe(true)
  })
})

describe('checkInsQuerySchema', () => {
  test('coerces the limit and the deleted flag', () => {
    expect(checkInsQuerySchema.parse({ deleted: 'true', limit: '10' })).toEqual({ deleted: true, limit: 10 })
    expect(checkInsQuerySchema.parse({}).limit).toBe(50)
    expect(checkInsQuerySchema.safeParse({ limit: '500' }).success).toBe(false)
  })
})

describe('logs_to', () => {
  const question = (logsTo: unknown, type = 'number') => ({
    key: 'item',
    logs_to: logsTo,
    prompt: 'Item',
    type,
    ...(type === 'choice'
      ? {
          options: [
            { key: 'a', label: 'A' },
            { key: 'b', label: 'B' },
          ],
        }
      : {}),
  })
  const parse = (...questions: unknown[]) => addCheckInFormBodySchema.safeParse({ name: 'F', questions })

  test('takes a metric or an activity type', () => {
    expect(parse(question({ metric: 'dose_mg' })).success).toBe(true)
    expect(
      parse(question({ activity_type: 'supplement', answer_field: 'dose', fields: { substance: 'zinc' } }))
        .success,
    ).toBe(true)
    expect(parse(question({ activity_type: 'supplement' }, 'yes_no')).success).toBe(true)
  })

  test.each([
    [{}],
    [{ activity_type: 'supplement', metric: 'dose_mg' }],
    [{ fields: { substance: 'zinc' }, metric: 'dose_mg' }],
  ])('refuses %j', (logsTo) => {
    expect(parse(question(logsTo)).success).toBe(false)
  })

  test('an activity is logged from number, scale and yes/no only; yes/no has no answer_field', () => {
    expect(messages(parse(question({ activity_type: 'supplement' }, 'choice')))).toContain(
      'A choice answer cannot be logged as an activity',
    )
    expect(
      messages(parse(question({ activity_type: 'supplement', answer_field: 'dose' }, 'yes_no'))),
    ).toContain('A yes/no answer logs the activity on yes and has no answer_field')
  })

  test('only metric targets count towards a metric logged twice', () => {
    expect(
      parse(question({ activity_type: 'supplement' }), {
        ...question({ activity_type: 'supplement' }),
        key: 'other',
      }).success,
    ).toBe(true)
  })
})

describe('isCheckInRoutine', () => {
  const item = { key: 'a', prompt: 'A', required: true, type: 'yes_no' as const }
  test('every required question has a default, and one has', () => {
    expect(isCheckInRoutine([{ ...item, default: true }])).toBe(true)
    expect(
      isCheckInRoutine([
        { ...item, default: true },
        { ...item, key: 'b', required: false },
      ]),
    ).toBe(true)
    expect(isCheckInRoutine([item])).toBe(false)
    expect(isCheckInRoutine([{ ...item, required: false }])).toBe(false)
    expect(isCheckInRoutine([{ ...item, default: '', type: 'text' as const }])).toBe(false)
  })
})

describe('routine items', () => {
  const vitaminD: CheckInQuestion = {
    default: 50,
    key: 'vitamin_d',
    logs_to: { activity_type: 'supplement', answer_field: 'dose', fields: { substance: 'vitamin D' } },
    prompt: 'Vitamin D',
    required: true,
    type: 'number',
    unit: 'µg',
  }
  const fishOil: CheckInQuestion = {
    default: true,
    key: 'fish_oil',
    logs_to: { activity_type: 'supplement', fields: { substance: 'fish oil' } },
    prompt: 'Fish oil',
    required: false,
    type: 'yes_no',
  }
  const rested: CheckInQuestion = {
    key: 'rested',
    max: 5,
    min: 1,
    prompt: 'How rested?',
    required: true,
    type: 'scale',
  }
  const feel: CheckInQuestion = {
    key: 'feel',
    options: [{ key: 'ok', label: 'OK' }],
    prompt: 'Feel',
    required: false,
    type: 'choice',
  }
  const tags: CheckInQuestion = {
    key: 'tags',
    options: [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ],
    prompt: 'Tags',
    required: false,
    type: 'multi_choice',
  }
  const note: CheckInQuestion = { key: 'note', prompt: 'Note', required: false, type: 'text' }

  test('presetLine lists the items taken, with dose and unit', () => {
    expect(presetLine([vitaminD, fishOil, { ...rested, default: 4 }])).toBe(
      'Vitamin D 50 µg, Fish oil, How rested? 4',
    )
    expect(
      presetLine([
        { ...fishOil, default: false },
        { ...vitaminD, default: 0 },
      ]),
    ).toBe('')
  })

  test('presetItem labels choices, and is null for an answer not taken', () => {
    expect(presetItem(feel, 'ok')).toBe('Feel: OK')
    expect(presetItem(tags, ['a', 'b'])).toBe('Tags: A, B')
    expect(presetItem(note, 'slept well')).toBe('Note: slept well')
    expect(presetItem(note, '  ')).toBeNull()
    expect(presetItem(vitaminD, 0)).toBeNull()
  })

  test('isTakenAnswer: given and not 0 or no', () => {
    expect(isTakenAnswer(fishOil, true)).toBe(true)
    expect(isTakenAnswer(fishOil, false)).toBe(false)
    expect(isTakenAnswer(vitaminD, 0)).toBe(false)
    expect(isTakenAnswer(vitaminD, undefined)).toBe(false)
    expect(isTakenAnswer(vitaminD, 25)).toBe(true)
    expect(isTakenAnswer(tags, [])).toBe(false)
  })
})

describe('skips and entities on submit', () => {
  const form_id = '00000000-0000-4000-8000-000000000001'
  const scheduled_for = '2026-11-20T07:00:00.000Z'

  test('a skip needs scheduled_for and takes no answers', () => {
    expect(submitCheckInBodySchema.safeParse({ form_id, scheduled_for, status: 'skipped' }).success).toBe(
      true,
    )
    expect(messages(submitCheckInBodySchema.safeParse({ form_id, status: 'skipped' }))).toEqual([
      'A skip needs scheduled_for',
    ])
    expect(
      messages(
        submitCheckInBodySchema.safeParse({ answers: { a: 1 }, form_id, scheduled_for, status: 'skipped' }),
      ),
    ).toEqual(['A skip has no answers'])
    expect(
      messages(
        submitCheckInBodySchema.safeParse({ form_id, scheduled_for, status: 'skipped', use_defaults: true }),
      ),
    ).toEqual(['A skip has no answers'])
  })

  test('entity_type and entity_id go together', () => {
    expect(submitCheckInBodySchema.safeParse({ entity_type: 'activity', form_id }).success).toBe(false)
    expect(
      submitCheckInBodySchema.safeParse({ entity_id: form_id, entity_type: 'activity', form_id }).success,
    ).toBe(true)
    expect(checkInsQuerySchema.safeParse({ entity_id: form_id }).success).toBe(false)
    expect(checkInsQuerySchema.safeParse({ entity_id: form_id, entity_type: 'activity' }).success).toBe(true)
  })
})
