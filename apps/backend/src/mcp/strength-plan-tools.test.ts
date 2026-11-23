import type { StrengthPlan } from '@aurboda/api-spec'
import type { z } from 'zod'

import { describe, expect, test, vi } from 'vitest'

import type { StrengthPlansService } from '../services/strength-plans.ts'
import type { McpServer } from './helpers.ts'

import { registerStrengthPlanTools } from './strength-plan-tools.ts'

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

const plan: StrengthPlan = {
  created_at: '2026-11-01T10:00:00.000Z',
  id: '11111111-1111-4111-8111-111111111111',
  muscle_groups: ['chest'],
  name: 'Push day',
  note: null,
  planned_for: '2026-11-19',
  sessions: [],
  sets: [{ exercise: 'Bench Press', reps: 8, weight: 60 }],
  updated_at: '2026-11-01T10:00:00.000Z',
}

const setup = (overrides: Partial<StrengthPlansService> = {}) => {
  const service: StrengthPlansService = {
    create: vi.fn(async () => ({ data: plan, success: true as const })),
    get: vi.fn(async () => ({ data: plan, success: true as const })),
    list: vi.fn(async () => [plan]),
    remove: vi.fn(async () => ({ data: null, success: true as const })),
    update: vi.fn(async () => ({ data: { ...plan, name: 'Push' }, success: true as const })),
    ...overrides,
  }
  const tools = new Map<string, { description: string; handler: ToolHandler }>()
  const server = {
    tool: (name: string, description: string, _shape: unknown, handler: ToolHandler) =>
      tools.set(name, { description, handler }),
  } as unknown as McpServer
  registerStrengthPlanTools(server, 'alice', service)
  const call = async (name: string, params: Record<string, unknown> = {}) =>
    (await tools.get(name)!.handler(params)).content[0]!.text
  return { call, service, tools }
}

describe('strength plan MCP tools', () => {
  test('registers the five tools', () => {
    expect([...setup().tools.keys()].sort()).toEqual([
      'create_strength_plan',
      'delete_strength_plan',
      'get_strength_plan',
      'list_strength_plans',
      'update_strength_plan',
    ])
  })

  test('create_strength_plan tells an assistant what to read before planning', () => {
    const { description } = setup().tools.get('create_strength_plan')!
    for (const tool of [
      'get_muscle_recovery',
      'get_strength_score',
      'list_activity_field_values',
      'search_exercise_catalog',
      'list_strength_plans',
    ]) {
      expect(description).toContain(tool)
    }
  })

  test('list, get, create, update and delete call the service for the user', async () => {
    const { call, service } = setup()
    expect(JSON.parse(await call('list_strength_plans', { status: 'all' }))).toEqual({ plans: [plan] })
    expect(service.list).toHaveBeenCalledWith('alice', 'all')

    expect(JSON.parse(await call('get_strength_plan', { id: plan.id }))).toEqual(plan)
    expect(service.get).toHaveBeenCalledWith('alice', plan.id)

    const body = { name: 'Push day', planned_for: '2026-11-19', sets: plan.sets }
    expect(JSON.parse(await call('create_strength_plan', body))).toEqual(plan)
    expect(service.create).toHaveBeenCalledWith('alice', body)

    expect(JSON.parse(await call('update_strength_plan', { id: plan.id, name: 'Push' })).name).toBe('Push')
    expect(service.update).toHaveBeenCalledWith('alice', plan.id, { name: 'Push' })

    expect(JSON.parse(await call('delete_strength_plan', { id: plan.id }))).toEqual({
      deleted: true,
      id: plan.id,
    })
  })

  test('update_strength_plan clears the day and the note with an empty string', async () => {
    const { call, service } = setup()
    await call('update_strength_plan', { id: plan.id, note: '', planned_for: '' })
    expect(service.update).toHaveBeenCalledWith('alice', plan.id, { note: null, planned_for: null })

    await call('update_strength_plan', { id: plan.id, note: 'Easy week', planned_for: '2026-11-20' })
    expect(service.update).toHaveBeenLastCalledWith('alice', plan.id, {
      note: 'Easy week',
      planned_for: '2026-11-20',
    })
  })

  test('update_strength_plan refuses a day that is no date', async () => {
    const { call, service } = setup()
    expect(await call('update_strength_plan', { id: plan.id, planned_for: '2026-13-40' })).not.toContain(
      plan.id,
    )
    expect(service.update).not.toHaveBeenCalled()
  })

  test('no tool has a nullable field', () => {
    const shapes: Record<string, z.ZodType>[] = []
    const server = {
      tool: (_name: string, _description: string, shape: Record<string, z.ZodType>) => shapes.push(shape),
    } as unknown as McpServer
    registerStrengthPlanTools(server, 'alice', setup().service)
    for (const shape of shapes) {
      for (const field of Object.values(shape)) expect(field.safeParse(null).success).toBe(false)
    }
  })

  test('errors come back as text', async () => {
    const { call } = setup({
      create: vi.fn(async () => ({
        error: 'sets[0].exercise_key: unknown exercise catalogue key "x"',
        status: 400 as const,
        success: false as const,
      })),
      get: vi.fn(async () => ({ error: 'Plan not found', status: 404 as const, success: false as const })),
      remove: vi.fn(async () => ({ error: 'Plan not found', status: 404 as const, success: false as const })),
    })
    expect(await call('get_strength_plan', { id: 'x' })).toBe('Plan not found')
    expect(await call('delete_strength_plan', { id: 'x' })).toBe('Plan not found')
    expect(await call('create_strength_plan', { name: 'X', sets: [] })).toContain(
      'unknown exercise catalogue key',
    )
  })
})
