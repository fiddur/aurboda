import type { CheckInTemplate } from '@aurboda/api-spec'

const OWN_TEMPLATE = {
  licence: 'Written for Aurboda; free to use and change',
  source: 'Aurboda',
}

const WHO_5_OPTIONS = [
  { key: 'all', label: 'All of the time', value: 5 },
  { key: 'most', label: 'Most of the time', value: 4 },
  { key: 'more_than_half', label: 'More than half of the time', value: 3 },
  { key: 'less_than_half', label: 'Less than half of the time', value: 2 },
  { key: 'some', label: 'Some of the time', value: 1 },
  { key: 'none', label: 'At no time', value: 0 },
]

const WHO_5_STATEMENTS = [
  ['cheerful', 'I have felt cheerful and in good spirits'],
  ['calm', 'I have felt calm and relaxed'],
  ['active', 'I have felt active and vigorous'],
  ['rested', 'I woke up feeling fresh and rested'],
  ['interested', 'My daily life has been filled with things that interest me'],
] as const

export const checkInTemplates: readonly CheckInTemplate[] = [
  {
    ...OWN_TEMPLATE,
    description: 'How rested you feel when you get up.',
    id: 'morning',
    name: 'Morning check-in',
    questions: [
      {
        key: 'rested',
        logs_to: { metric: 'rested' },
        max: 5,
        max_label: 'Fully rested',
        min: 1,
        min_label: 'Exhausted',
        prompt: 'How rested do you feel?',
        required: true,
        type: 'scale',
      },
    ],
    score: null,
  },
  {
    ...OWN_TEMPLATE,
    description: 'Your mood and energy right now.',
    id: 'mood_energy',
    name: 'Mood and energy',
    questions: [
      {
        key: 'mood',
        logs_to: { metric: 'mood' },
        max: 5,
        max_label: 'Very good',
        min: 1,
        min_label: 'Very low',
        prompt: 'How is your mood?',
        required: true,
        type: 'scale',
      },
      {
        key: 'energy',
        logs_to: { metric: 'energy' },
        max: 5,
        max_label: 'Full of energy',
        min: 1,
        min_label: 'Drained',
        prompt: 'How is your energy?',
        required: true,
        type: 'scale',
      },
      { key: 'notes', prompt: 'Anything on your mind?', required: false, type: 'text' },
    ],
    score: null,
  },
  {
    ...OWN_TEMPLATE,
    description:
      'An example routine: two supplements with their usual doses, each logged as a supplement activity. Change the items and doses to your own.',
    id: 'morning_supplements',
    name: 'Morning supplements (example)',
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
      {
        default: 200,
        key: 'magnesium',
        logs_to: {
          activity_type: 'supplement',
          answer_field: 'dose',
          fields: { dose_unit: 'mg', substance: 'magnesium' },
        },
        min: 0,
        prompt: 'Magnesium',
        required: false,
        type: 'number',
        unit: 'mg',
      },
    ],
    score: null,
  },
  {
    description:
      'Five statements about how you have felt over the last two weeks. The score runs from 0 to 100; higher is better.',
    id: 'who_5',
    licence: 'CC BY-NC-SA 3.0 IGO; wording unchanged',
    name: 'WHO-5 Well-Being Index',
    questions: WHO_5_STATEMENTS.map(([key, prompt]) => ({
      key,
      options: WHO_5_OPTIONS,
      prompt,
      required: true,
      type: 'choice' as const,
    })),
    score: { factor: 4, metric: 'who_5', questions: WHO_5_STATEMENTS.map(([key]) => key) },
    source: 'World Health Organization: The World Health Organization-Five Well-Being Index (WHO-5), 2024',
  },
]

export const findCheckInTemplate = (id: string): CheckInTemplate | undefined =>
  checkInTemplates.find((template) => template.id === id)
