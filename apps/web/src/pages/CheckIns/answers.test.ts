import type { CheckInQuestion } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  answerProblems,
  answersToDrafts,
  draftsToAnswers,
  fromLocalInput,
  missingRequired,
  stepNumber,
  toLocalInput,
} from './answers'

const questions: CheckInQuestion[] = [
  { key: 'rested', max: 5, min: 1, prompt: 'How rested?', required: true, type: 'scale' },
  {
    key: 'coffee',
    max: 10,
    min: 0,
    prompt: 'Cups of coffee',
    required: false,
    step: 0.5,
    type: 'number',
    unit: 'cups',
  },
  { key: 'pain', prompt: 'Any pain?', required: true, type: 'yes_no' },
  {
    key: 'where',
    options: [
      { key: 'home', label: 'Home' },
      { key: 'work', label: 'Work' },
    ],
    prompt: 'Where?',
    required: false,
    type: 'choice',
  },
  {
    key: 'drinks',
    options: [
      { key: 'tea', label: 'Tea' },
      { key: 'juice', label: 'Juice' },
    ],
    prompt: 'Drinks',
    required: false,
    type: 'multi_choice',
  },
  { key: 'note', prompt: 'Anything else?', required: false, type: 'text' },
]

const number = questions[1] as Extract<CheckInQuestion, { type: 'number' }>

describe('draftsToAnswers', () => {
  test('reads number text, trims text and leaves blanks out', () => {
    expect(
      draftsToAnswers(questions, {
        coffee: '1,5',
        drinks: [],
        note: '  ok ',
        pain: false,
        rested: 4,
        where: undefined,
      }),
    ).toEqual({ coffee: 1.5, note: 'ok', pain: false, rested: 4 })
  })

  test('round-trips through answersToDrafts', () => {
    const answers = { coffee: 2, drinks: ['tea'], pain: true, rested: 3 }
    expect(draftsToAnswers(questions, answersToDrafts(questions, answers))).toEqual(answers)
  })
})

describe('missingRequired and answerProblems', () => {
  test('name the required questions left blank', () => {
    expect(missingRequired(questions, { rested: 3 }).map((q) => q.key)).toEqual(['pain'])
    expect(answerProblems(questions, {})).toEqual(['Please answer “How rested?”, “Any pain?”.'])
  })

  test('mirror the server: range, number and option', () => {
    expect(answerProblems(questions, { coffee: '12', pain: true, rested: 3 })).toEqual([
      '“Cups of coffee” must be at most 10.',
    ])
    expect(answerProblems(questions, { coffee: 'lots', pain: true, rested: 3 })).toEqual([
      '“Cups of coffee” must be a number.',
    ])
    expect(answerProblems(questions, { pain: true, rested: 3, where: 'moon' })).toEqual([
      'Pick one of the options for “Where?”.',
    ])
    expect(answerProblems(questions, { pain: false, rested: 1 })).toEqual([])
  })
})

describe('stepNumber', () => {
  test('steps by the step within min and max', () => {
    expect(stepNumber(number, '1', 1)).toBe('1.5')
    expect(stepNumber(number, '10', 1)).toBe('10')
    expect(stepNumber(number, '0', -1)).toBe('0')
  })

  test('starts from the min going up and the max going down', () => {
    expect(stepNumber(number, undefined, 1)).toBe('0')
    expect(stepNumber(number, '', -1)).toBe('10')
  })
})

describe('local time inputs', () => {
  test('round-trip a local time', () => {
    const at = new Date(2026, 10, 20, 8, 12)
    expect(toLocalInput(at)).toBe('2026-11-20T08:12')
    expect(fromLocalInput('2026-11-20T08:12')).toBe(at.toISOString())
    expect(fromLocalInput('')).toBeNull()
  })
})
