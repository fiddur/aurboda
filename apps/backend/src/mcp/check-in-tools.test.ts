import { describe, expect, test } from 'vitest'

import type { McpServer } from './helpers.ts'

import { fakeCheckInDeps } from '../services/__fixtures__/check-in-deps.ts'
import { registerCheckInTools } from './check-in-tools.ts'

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>

const setup = () => {
  const fake = fakeCheckInDeps({ now: new Date('2026-11-20T07:10:00Z') })
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _description: string, _shape: unknown, handler: ToolHandler) =>
      tools.set(name, handler),
  } as unknown as McpServer
  registerCheckInTools(server, 'alice', fake.deps)
  const call = async (name: string, params: Record<string, unknown> = {}) => {
    const result = await tools.get(name)!(params)
    return { error: result.isError === true, text: result.content[0]!.text }
  }
  const json = async (name: string, params: Record<string, unknown> = {}) =>
    JSON.parse((await call(name, params)).text)
  return { ...fake, call, json, tools }
}

const question = {
  key: 'rested',
  logs_to: { metric: 'rested' },
  max: 5,
  min: 1,
  prompt: 'Rested?',
  type: 'scale',
}

describe('check-in MCP tools', () => {
  test('registers the issue’s tools plus get_check_in_form', () => {
    expect([...setup().tools.keys()].sort()).toEqual([
      'add_check_in_form',
      'delete_check_in',
      'delete_check_in_form',
      'get_check_in_adherence',
      'get_check_in_form',
      'list_check_in_forms',
      'list_check_in_templates',
      'list_due',
      'query_check_ins',
      'restore_check_in',
      'restore_check_in_form',
      'submit_check_in',
      'update_check_in',
      'update_check_in_form',
    ])
  })

  test('forms round-trip like the REST routes', async () => {
    const { call, json } = setup()
    const { form } = await json('add_check_in_form', {
      name: 'Morning',
      questions: [question],
      schedule: { times: ['08:00'] },
    })
    expect(form.version).toBe(1)
    expect((await json('get_check_in_form', { id: form.id })).form.id).toBe(form.id)
    expect((await json('list_check_in_forms')).forms).toHaveLength(1)
    expect((await json('update_check_in_form', { id: form.id, name: 'Mornings' })).form.name).toBe('Mornings')
    expect((await json('delete_check_in_form', { id: form.id })).form.deleted_at).not.toBeNull()
    expect((await json('list_check_in_forms', { deleted: true })).forms).toHaveLength(1)
    expect((await json('restore_check_in_form', { id: form.id })).form.deleted_at).toBeNull()
    expect(await call('get_check_in_form', { id: 'nope' })).toMatchObject({ error: true })
  })

  test('schema errors come back as tool errors naming the field', async () => {
    const { call } = setup()
    const result = await call('add_check_in_form', { name: 'Bad', questions: [{ ...question, max: 1 }] })
    expect(result.error).toBe(true)
    expect(result.text).toContain('max must be above min')
  })

  test('check-ins, templates and due slots', async () => {
    const { call, json, points } = setup()
    const { form } = await json('add_check_in_form', { schedule: { times: ['08:00'] }, template: 'morning' })
    expect((await json('list_check_in_templates')).templates).toHaveLength(2)
    const { check_in } = await json('submit_check_in', { answers: { rested: 4 }, form_id: form.id })
    expect(points).toHaveLength(1)
    expect((await json('query_check_ins', {})).check_ins).toHaveLength(1)
    expect(
      (await json('update_check_in', { answers: { rested: 2 }, id: check_in.id })).check_in.answers,
    ).toEqual({
      rested: 2,
    })
    expect((await json('list_due')).slots[0]).toMatchObject({ check_in_id: check_in.id, state: 'done' })
    expect((await json('delete_check_in', { id: check_in.id })).check_in.deleted_at).not.toBeNull()
    expect((await json('restore_check_in', { id: check_in.id })).check_in.deleted_at).toBeNull()
    expect(await call('submit_check_in', { answers: {}, form_id: form.id })).toMatchObject({ error: true })
  })

  test('a routine in one go, a skip and the adherence', async () => {
    const { call, json } = setup()
    const { form } = await json('add_check_in_form', {
      schedule: { times: ['08:00'] },
      template: 'morning_supplements',
    })
    expect(form.is_routine).toBe(true)
    const { check_in } = await json('submit_check_in', { form_id: form.id, use_defaults: true })
    expect(check_in.answers).toEqual({ magnesium: 200, vitamin_d: 50 })
    const skip = { form_id: form.id, scheduled_for: '2026-11-19T07:00:00.000Z', status: 'skipped' }
    expect((await json('submit_check_in', skip)).check_in.status).toBe('skipped')
    expect(await call('submit_check_in', skip)).toMatchObject({ error: true })
    const { adherence } = await json('get_check_in_adherence', {
      from: '2026-11-19',
      id: form.id,
      to: '2026-11-20',
    })
    expect(adherence.totals).toEqual({ done: 1, missed: 0, skipped: 1, upcoming: 0 })
    expect(adherence.questions.map((q: { answered: number }) => q.answered)).toEqual([1, 1])
    expect(await call('get_check_in_adherence', { from: 'x', id: form.id })).toMatchObject({ error: true })
  })
})
