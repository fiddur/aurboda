import {
  addCheckInFormBodySchema,
  checkInFormProblems,
  checkInTemplateSchema,
  isCheckInRoutine,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { checkInTemplates, findCheckInTemplate } from './check-in-templates.ts'

describe('checkInTemplates', () => {
  test('are morning, mood and energy, and the example routine', () => {
    expect(checkInTemplates.map((template) => template.id)).toEqual([
      'morning',
      'mood_energy',
      'morning_supplements',
    ])
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
