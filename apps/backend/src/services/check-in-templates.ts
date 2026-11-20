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
]

export const findCheckInTemplate = (id: string): CheckInTemplate | undefined =>
  checkInTemplates.find((template) => template.id === id)
