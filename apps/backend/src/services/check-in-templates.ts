import type { CheckInTemplate } from '@aurboda/api-spec'

const OWN_TEMPLATE = {
  licence: 'Written for Aurboda; free to use and change',
  source: 'Aurboda',
}

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
]

export const findCheckInTemplate = (id: string): CheckInTemplate | undefined =>
  checkInTemplates.find((template) => template.id === id)
