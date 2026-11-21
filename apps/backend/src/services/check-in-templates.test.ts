import {
  addCheckInFormBodySchema,
  checkInFormProblems,
  checkInTemplateSchema,
  isCheckInRoutine,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { checkInTemplates, findCheckInTemplate } from './check-in-templates.ts'

describe('checkInTemplates', () => {
  test('are morning, mood and energy, the example routine and the WHO-5', () => {
    expect(checkInTemplates.map((template) => template.id)).toEqual([
      'morning',
      'mood_energy',
      'morning_supplements',
      'who_5',
    ])
  })

  test('the WHO-5 keeps its source and licence, and scores 0 to 100', () => {
    const who5 = findCheckInTemplate('who_5')!
    expect(who5.source).toContain('World Health Organization')
    expect(who5.licence).toBe('CC BY-NC-SA 3.0 IGO; wording unchanged')
    expect(who5.questions.map((question) => question.key)).toEqual([
      'cheerful',
      'calm',
      'active',
      'rested',
      'interested',
    ])
    expect(who5.questions.every((question) => question.required && question.logs_to === undefined)).toBe(true)
    expect(who5.score).toEqual({
      factor: 4,
      metric: 'who_5',
      questions: ['cheerful', 'calm', 'active', 'rested', 'interested'],
    })
  })

  test('the example routine is a routine logging supplement activities', () => {
    const routine = findCheckInTemplate('morning_supplements')!
    expect(isCheckInRoutine(routine.questions)).toBe(true)
    expect(routine.questions.map((question) => question.logs_to?.activity_type)).toEqual([
      'supplement',
      'supplement',
    ])
  })

  test.each(checkInTemplates.map((template) => [template.id, template] as const))(
    '%s is a valid form with a source and a licence',
    (_id, template) => {
      expect(checkInTemplateSchema.parse(template)).toEqual(template)
      expect(checkInFormProblems(template.questions, template.score)).toEqual([])
      expect(
        addCheckInFormBodySchema.safeParse({ name: template.name, questions: template.questions }).success,
      ).toBe(true)
      expect(template.source).not.toBe('')
      expect(template.licence).not.toBe('')
    },
  )

  test('findCheckInTemplate is undefined for an unknown id', () => {
    expect(findCheckInTemplate('nope')).toBeUndefined()
  })
})
