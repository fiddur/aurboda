import { describe, expect, test } from 'vitest'

import { mcpRequestBudgetError } from './request-budget.ts'

const call = (args: unknown, id = 1) => ({
  id,
  jsonrpc: '2.0',
  method: 'tools/call',
  params: { arguments: args, name: 'add_metrics_bulk' },
})

const nested = (levels: number): unknown => {
  let value: unknown = 'leaf'
  for (let i = 0; i < levels; i++) value = { next: value }
  return value
}

describe('mcpRequestBudgetError', () => {
  test('passes an ordinary call and scalars', () => {
    expect(mcpRequestBudgetError(call({ tag: 'coffee' }))).toBeNull()
    expect(mcpRequestBudgetError(undefined)).toBeNull()
    expect(mcpRequestBudgetError('text')).toBeNull()
  })

  test('passes a 10,000-point add_metrics_bulk', () => {
    const metrics = Array.from({ length: 10_000 }, (_, i) => ({
      metric: 'heart_rate',
      source: 'aurboda',
      timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      value: 60 + (i % 40),
    }))
    expect(mcpRequestBudgetError(call({ metrics }))).toBeNull()
  })

  test('passes a batch of 20 and refuses one of 21', () => {
    expect(mcpRequestBudgetError(Array.from({ length: 20 }, (_, i) => call({}, i)))).toBeNull()
    expect(mcpRequestBudgetError(Array.from({ length: 21 }, (_, i) => call({}, i)))).toMatch(/batch/)
  })

  test('passes 64 levels of nesting and refuses 65', () => {
    expect(mcpRequestBudgetError(nested(64))).toBeNull()
    expect(mcpRequestBudgetError(nested(65))).toMatch(/nesting/)
  })

  test('refuses nesting far too deep for recursion without throwing', () => {
    expect(mcpRequestBudgetError(nested(200_000))).toMatch(/nesting/)
  })

  test('counts array items and property values as elements', () => {
    const limits = { maxBatch: 20, maxDepth: 64, maxElements: 5 }
    expect(mcpRequestBudgetError({ a: [1, 2], b: 3 }, limits)).toBeNull()
    expect(mcpRequestBudgetError({ a: [1, 2, 3, 4], b: 5 }, limits)).toMatch(/elements/)
  })

  test('refuses more than 100,000 elements', () => {
    expect(mcpRequestBudgetError(call({ values: Array.from({ length: 100_001 }, () => 0) }))).toMatch(
      /elements/,
    )
  })
})
