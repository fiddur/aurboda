import { describe, expect, test } from 'vitest'

import {
  buildExerciseShareBody,
  type ExerciseShareForm,
  exerciseSharePreviewKey,
} from './exercise-share-body'

const form: ExerciseShareForm = {
  activityType: 'strength_training',
  field: 'sets.exercise',
  includeChart: true,
  includeLink: true,
  includeRecords: true,
  includeSessions: false,
  message: '',
  published: true,
  value: 'Bench Press',
  visibility: 'public',
}

describe('buildExerciseShareBody', () => {
  test('maps the form onto the body', () => {
    expect(buildExerciseShareBody(form)).toEqual({
      activity_type: 'strength_training',
      field: 'sets.exercise',
      include_chart: true,
      include_link: true,
      include_records: true,
      include_sessions: false,
      value: 'Bench Press',
      visibility: 'public',
    })
  })

  test('trims the message', () => {
    expect(buildExerciseShareBody({ ...form, message: '  New PR!\n' }).message).toBe('New PR!')
  })

  test('omits a blank message', () => {
    expect(buildExerciseShareBody({ ...form, message: '   ' })).not.toHaveProperty('message')
  })

  test('includes no link when the exercise is not published', () => {
    expect(buildExerciseShareBody({ ...form, published: false }).include_link).toBe(false)
  })

  test('includes no link when it is unchecked', () => {
    expect(buildExerciseShareBody({ ...form, includeLink: false }).include_link).toBe(false)
  })
})

describe('exerciseSharePreviewKey', () => {
  test('ignores the visibility', () => {
    const body = buildExerciseShareBody(form)
    expect(exerciseSharePreviewKey({ ...body, visibility: 'followers' })).toBe(exerciseSharePreviewKey(body))
    expect(JSON.parse(exerciseSharePreviewKey(body))).not.toHaveProperty('visibility')
  })

  test('changes with the opt-ins', () => {
    const body = buildExerciseShareBody(form)
    expect(exerciseSharePreviewKey({ ...body, include_sessions: true })).not.toBe(
      exerciseSharePreviewKey(body),
    )
  })
})
