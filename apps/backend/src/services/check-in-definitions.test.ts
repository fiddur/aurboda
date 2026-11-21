import type { CheckInQuestion } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  activityItemsFor,
  activityTargetProblems,
  answerProblems,
  defaultProblems,
  definitionChanged,
  metricPointsFor,
  numericAnswer,
  presetAnswers,
  reusedKeyProblems,
  scoreOf,
} from './check-in-definitions.ts'

const rested: CheckInQuestion = {
  key: 'rested',
  logs_to: { metric: 'rested' },
  max: 5,
  min: 1,
  prompt: 'How rested?',
  required: true,
  type: 'scale',
}
const dose: CheckInQuestion = {
  key: 'dose',
  logs_to: { metric: 'ibuprofen_mg' },
  max: 800,
  min: 0,
  prompt: 'Dose',
  required: false,
  type: 'number',
  unit: 'mg',
}
const took: CheckInQuestion = {
  key: 'took',
  logs_to: { metric: 'vitamin_d' },
  prompt: 'Vitamin D?',
  required: false,
  type: 'yes_no',
}
const feel: CheckInQuestion = {
  key: 'feel',
  logs_to: { metric: 'feel' },
  options: [
    { key: 'bad', label: 'Bad', value: 0 },
    { key: 'ok', label: 'OK', value: 2 },
  ],
  prompt: 'Feel?',
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
const notes: CheckInQuestion = { key: 'notes', prompt: 'Notes', required: false, type: 'text' }

const all = [rested, dose, took, feel, tags, notes]

describe('definitionChanged', () => {
  test('reordering questions is not a change', () => {
    expect(
      definitionChanged(
        { questions: [rested, dose], score: null },
        { questions: [dose, rested], score: null },
      ),
    ).toBe(false)
  })

  test.each([
    ['prompt', { ...rested, prompt: 'How rested are you?' }],
    ['type settings', { ...rested, max: 7 }],
    ['logs_to', { ...rested, logs_to: { metric: 'tiredness' } }],
    ['required', { ...rested, required: false }],
  ])('a change of %s is a change', (_label, changed) => {
    expect(
      definitionChanged({ questions: [rested], score: null }, { questions: [changed], score: null }),
    ).toBe(true)
  })

  test('an added or removed question is a change', () => {
    expect(
      definitionChanged({ questions: [rested], score: null }, { questions: [rested, dose], score: null }),
    ).toBe(true)
    expect(
      definitionChanged({ questions: [rested, dose], score: null }, { questions: [rested], score: null }),
    ).toBe(true)
  })

  test('the score changes it, but not the order of its questions or an explicit factor of 1', () => {
    const before = { questions: [rested, dose], score: { metric: 's', questions: ['rested', 'dose'] } }
    expect(
      definitionChanged(before, {
        ...before,
        score: { factor: 1, metric: 's', questions: ['dose', 'rested'] },
      }),
    ).toBe(false)
    expect(
      definitionChanged(before, {
        ...before,
        score: { factor: 2, metric: 's', questions: ['rested', 'dose'] },
      }),
    ).toBe(true)
    expect(definitionChanged(before, { ...before, score: null })).toBe(true)
  })

  test('an undefined optional field equals a missing one', () => {
    expect(
      definitionChanged(
        { questions: [dose], score: null },
        { questions: [{ ...dose, step: undefined }], score: null },
      ),
    ).toBe(false)
  })
})

describe('reusedKeyProblems', () => {
  test('a removed key may come back with its old type', () => {
    expect(reusedKeyProblems([[rested, notes], [rested]], [rested], [rested, notes])).toEqual([])
  })

  test('a removed key may not come back with another type', () => {
    const problems = reusedKeyProblems(
      [[rested, notes], [rested]],
      [rested],
      [rested, { ...took, key: 'notes' }],
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('"notes"')
  })

  test('a live key may change type', () => {
    expect(reusedKeyProblems([[rested]], [rested], [{ ...took, key: 'rested' }])).toEqual([])
  })
})

describe('answerProblems', () => {
  test('accepts valid answers of every type', () => {
    expect(
      answerProblems(all, { dose: 400, feel: 'ok', notes: 'fine', rested: 3, tags: ['a', 'b'], took: true }),
    ).toEqual([])
  })

  test('refuses unknown keys and missing required answers', () => {
    expect(answerProblems(all, { mystery: 1 })).toEqual([
      'No question "mystery" in this form',
      '"rested" is required',
    ])
  })

  test.each([
    [{ rested: 6 }, 'from 1 to 5'],
    [{ rested: 2.5 }, 'whole number'],
    [{ dose: 900, rested: 3 }, 'at most 800'],
    [{ dose: -1, rested: 3 }, 'at least 0'],
    [{ dose: 'x', rested: 3 }, 'must be a number'],
    [{ rested: 3, took: 'yes' }, 'true or false'],
    [{ feel: 'great', rested: 3 }, 'one of bad, ok'],
    [{ rested: 3, tags: ['c'] }, 'no option "c"'],
    [{ rested: 3, tags: ['a', 'a'] }, 'twice'],
    [{ notes: 3, rested: 3 }, 'must be text'],
  ])('refuses %j', (answers, message) => {
    expect(answerProblems(all, answers).join()).toContain(message)
  })

  test('blank text and an empty multi-choice count as unanswered', () => {
    expect(answerProblems([{ ...notes, required: true }], { notes: '  ' })).toEqual(['"notes" is required'])
    expect(answerProblems([{ ...tags, required: true }], { tags: [] })).toEqual(['"tags" is required'])
  })
})

describe('numericAnswer', () => {
  test('reads numbers, yes/no and choice values', () => {
    expect(numericAnswer(dose, 200)).toBe(200)
    expect(numericAnswer(took, true)).toBe(1)
    expect(numericAnswer(took, false)).toBe(0)
    expect(numericAnswer(feel, 'ok')).toBe(2)
    expect(numericAnswer(notes, 'x')).toBeUndefined()
    expect(numericAnswer(rested, undefined)).toBeUndefined()
  })
})

describe('scoreOf', () => {
  const score = { factor: 4, metric: 'total', questions: ['rested', 'feel'] }

  test('sums the answers times the factor', () => {
    expect(scoreOf(all, score, { feel: 'ok', rested: 3 })).toBe(20)
  })

  test('is absent when an answer is missing or there is no score', () => {
    expect(scoreOf(all, score, { rested: 3 })).toBeNull()
    expect(scoreOf(all, null, { rested: 3 })).toBeNull()
  })
})

describe('metricPointsFor', () => {
  test('logs answers with logs_to, skipping 0, no and missing ones', () => {
    expect(metricPointsFor(all, null, { dose: 0, feel: 'bad', notes: 'x', rested: 4, took: false })).toEqual([
      { key: 'rested', metric: 'rested', value: 4 },
    ])
    expect(metricPointsFor(all, null, { dose: 400, feel: 'ok', rested: 4, took: true })).toEqual([
      { key: 'rested', metric: 'rested', value: 4 },
      { key: 'dose', metric: 'ibuprofen_mg', unit: 'mg', value: 400 },
      { key: 'took', metric: 'vitamin_d', value: 1 },
      { key: 'feel', metric: 'feel', value: 2 },
    ])
  })

  test('logs the score, even 0, under _score', () => {
    const score = { metric: 'total', questions: ['feel'] }
    expect(metricPointsFor([{ ...feel, logs_to: undefined }], score, { feel: 'bad' })).toEqual([
      { key: '_score', metric: 'total', value: 0 },
    ])
  })
})

const supplement: CheckInQuestion = {
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

describe('activityItemsFor', () => {
  test('one activity per taken answer, the answer in answer_field; 0, no and none log nothing', () => {
    expect(
      activityItemsFor([supplement, fishOil, rested], { fish_oil: true, rested: 3, vitamin_d: 50 }),
    ).toEqual([
      { activity_type: 'supplement', data: { dose: 50, substance: 'vitamin D' }, key: 'vitamin_d' },
      { activity_type: 'supplement', data: { substance: 'fish oil' }, key: 'fish_oil' },
    ])
    expect(activityItemsFor([supplement, fishOil], { fish_oil: false, vitamin_d: 0 })).toEqual([])
    expect(activityItemsFor([supplement, fishOil], {})).toEqual([])
  })

  test('metric questions make no activities, and activity questions no metric points', () => {
    expect(metricPointsFor([supplement], null, { vitamin_d: 50 })).toEqual([])
  })
})

describe('defaultProblems', () => {
  test('a default must be a valid answer of its question', () => {
    expect(defaultProblems([supplement, fishOil])).toEqual([])
    expect(defaultProblems([{ ...rested, default: 7 }])).toEqual([
      'The default of "rested" must be a whole number from 1 to 5',
    ])
    expect(defaultProblems([{ ...fishOil, default: 1 }])).toEqual([
      'The default of "fish_oil" must be true or false',
    ])
  })
})

describe('activityTargetProblems', () => {
  const schema = {
    fields: [
      { name: 'substance', required: true, type: 'string' as const },
      { min: 0, name: 'dose', type: 'number' as const },
    ],
  }

  test('accepts declared fields and a number answer_field', () => {
    expect(activityTargetProblems(supplement, supplement.logs_to!, schema)).toEqual([])
    expect(activityTargetProblems(supplement, supplement.logs_to!, undefined)).toEqual([])
  })

  test('refuses an unknown field, a non-number answer_field and a missing required field', () => {
    const problems = activityTargetProblems(
      supplement,
      { activity_type: 'supplement', answer_field: 'substance', fields: { colour: 'red' } },
      schema,
    )
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('"colour" is not a field of this type')
    expect(problems[1]).toContain('answer_field "substance" is not a number field')
    expect(
      activityTargetProblems(supplement, { activity_type: 'supplement', answer_field: 'dose' }, schema),
    ).toEqual(['"vitamin_d" logs to "supplement": its field "substance" is required'])
  })
})

describe('presets', () => {
  test('presetAnswers takes the defaults', () => {
    expect(presetAnswers([supplement, fishOil, rested])).toEqual({ fish_oil: true, vitamin_d: 50 })
  })
})
