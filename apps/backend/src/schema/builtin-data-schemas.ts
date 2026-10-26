import type { DataSchemaDefinition } from '@aurboda/api-spec'

export const strengthTrainingDataSchema: DataSchemaDefinition = {
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
}
