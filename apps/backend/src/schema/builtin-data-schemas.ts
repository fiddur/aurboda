import type { DataSchemaDefinition } from '@aurboda/api-spec'

export const strengthTrainingDataSchema: DataSchemaDefinition = {
  fields: [
    {
      name: 'sets',
      type: 'list',
      label: 'Sets',
      item_fields: [
        { name: 'exercise', type: 'string', required: true, is_categorical: true },
        { name: 'weight', type: 'number', unit: 'kg' },
        { name: 'reps', type: 'number' },
        { name: 'time', type: 'number', unit: 's' },
      ],
    },
  ],
}

/** Earlier shapes of the built-in schema: a row still holding one exactly was never edited, so it is upgraded. */
export const previousStrengthTrainingDataSchemas: DataSchemaDefinition[] = [
  {
    fields: [
      {
        name: 'sets',
        type: 'list',
        label: 'Sets',
        item_fields: [
          { name: 'exercise', type: 'string', required: true },
          { name: 'weight', type: 'number', unit: 'kg' },
          { name: 'reps', type: 'number' },
          { name: 'time', type: 'number', unit: 's' },
        ],
      },
    ],
  },
]
