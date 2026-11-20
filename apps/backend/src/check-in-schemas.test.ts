import {
  addCheckInFormBodySchema,
  checkInFormProblems,
  checkInsQuerySchema,
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
