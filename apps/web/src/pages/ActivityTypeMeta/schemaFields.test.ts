import type { DataFieldDefinition } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  addItemField,
  removeItemField,
  setFieldType,
  updateItemField,
  validSchemaFields,
} from './schemaFields'

const listField = (item_fields: DataFieldDefinition['item_fields']): DataFieldDefinition => ({
  item_fields,
  label: 'Sets',
  name: 'sets',
  type: 'list',
})

describe('setFieldType', () => {
  test('to list: one empty item field, never categorical, no enum values or unit', () => {
    const field: DataFieldDefinition = {
      enum_values: ['a'],
      is_categorical: true,
      label: 'Sets',
      name: 'sets',
      type: 'string',
      unit: 'kg',
    }
    expect(setFieldType(field, 'list')).toEqual({
      item_fields: [{ name: '', type: 'string' }],
      label: 'Sets',
      name: 'sets',
      type: 'list',
    })
  })

  test('away from list drops the item fields', () => {
    expect(setFieldType(listField([{ name: 'reps', type: 'number' }]), 'number')).toEqual({
      label: 'Sets',
      name: 'sets',
      type: 'number',
    })
  })

  test('between scalars only changes the type', () => {
    expect(setFieldType({ name: 'x', required: true, type: 'string' }, 'number')).toEqual({
      name: 'x',
      required: true,
      type: 'number',
    })
  })

  test('list to list keeps the item fields', () => {
    const field = listField([{ name: 'reps', type: 'number' }])
    expect(setFieldType(field, 'list')).toEqual(field)
  })
})

describe('item fields', () => {
  const field = listField([
    { name: 'exercise', type: 'string' },
    { name: 'reps', type: 'number' },
  ])

  test('add appends an empty string field', () => {
    expect(addItemField(field).item_fields).toEqual([
      { name: 'exercise', type: 'string' },
      { name: 'reps', type: 'number' },
      { name: '', type: 'string' },
    ])
  })

  test('update patches one item field', () => {
    expect(updateItemField(field, 1, { unit: 'kg' }).item_fields).toEqual([
      { name: 'exercise', type: 'string' },
      { name: 'reps', type: 'number', unit: 'kg' },
    ])
  })

  test('remove drops one item field', () => {
    expect(removeItemField(field, 0).item_fields).toEqual([{ name: 'reps', type: 'number' }])
  })
})

describe('validSchemaFields', () => {
  test('keeps fields with valid names, filters item fields and drops a list left without any', () => {
    const fields: DataFieldDefinition[] = [
      { name: 'session_name', type: 'string' },
      { name: 'Bad Name', type: 'string' },
      { name: '', type: 'number' },
      listField([
        { name: 'exercise', type: 'string' },
        { name: '', type: 'number' },
      ]),
      { item_fields: [{ name: '9x', type: 'number' }], name: 'laps', type: 'list' },
      { item_fields: [], name: 'empty', type: 'list' },
    ]
    expect(validSchemaFields(fields)).toEqual([
      { name: 'session_name', type: 'string' },
      listField([{ name: 'exercise', type: 'string' }]),
    ])
  })
})
