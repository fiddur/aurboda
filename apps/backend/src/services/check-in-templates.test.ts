import { addCheckInFormBodySchema, checkInFormProblems, checkInTemplateSchema } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { checkInTemplates, findCheckInTemplate } from './check-in-templates.ts'

describe('checkInTemplates', () => {
  test('are morning, and mood and energy', () => {
    expect(checkInTemplates.map((template) => template.id)).toEqual(['morning', 'mood_energy'])
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
