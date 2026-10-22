import {
  activityFullDetailQuerySchema,
  queryBooleanSchema,
  queryRawRecordsQuerySchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

describe('queryBooleanSchema', () => {
  test.each([
    ['true', true],
    ['1', true],
    [true, true],
    ['false', false],
    ['0', false],
    [false, false],
  ])('reads %j as %s', (input, expected) => {
    expect(queryBooleanSchema.parse(input)).toBe(expected)
  })

  test.each(['no', 'yes', '', 'FALSE', 2])('rejects %j rather than reading it as true', (input) => {
    expect(queryBooleanSchema.safeParse(input).success).toBe(false)
  })
})

describe('activityFullDetailQuerySchema include_gps (#1239)', () => {
  test('defaults to true when absent', () => {
    expect(activityFullDetailQuerySchema.parse({}).include_gps).toBe(true)
  })

  test.each([
    ['false', false],
    ['0', false],
    ['true', true],
  ])('include_gps=%s is %s', (input, expected) => {
    expect(activityFullDetailQuerySchema.parse({ include_gps: input }).include_gps).toBe(expected)
  })

  test('rejects include_gps=no', () => {
    expect(activityFullDetailQuerySchema.safeParse({ include_gps: 'no' }).success).toBe(false)
  })
})

describe('queryRawRecordsQuerySchema include_data', () => {
  test('stays undefined when absent and reads false as false, from REST or MCP', () => {
    expect(queryRawRecordsQuerySchema.parse({}).include_data).toBeUndefined()
    expect(queryRawRecordsQuerySchema.parse({ include_data: 'false' }).include_data).toBe(false)
    expect(queryRawRecordsQuerySchema.parse({ include_data: false }).include_data).toBe(false)
    expect(queryRawRecordsQuerySchema.parse({ include_data: 'true' }).include_data).toBe(true)
  })
})
