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
        {
          name: 'set_type',
          type: 'string',
          label: 'Type',
          enum_values: ['normal', 'warmup', 'drop_set', 'failure'],
        },
        { name: 'rpe', type: 'number', label: 'RPE' },
        { name: 'rir', type: 'number', label: 'RIR' },
        { name: 'distance', type: 'number', unit: 'm' },
        { name: 'note', type: 'string' },
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
  {
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
  },
]
