import { describe, expect, test } from 'vitest'

import type { ReminderRecord } from '../db/index.ts'
import type { ReminderDeps } from '../services/reminders.ts'
import type { McpServer } from './helpers.ts'

import { registerReminderTools } from './reminder-tools.ts'

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

const ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-18T10:00:00Z')

const record = (overrides: Partial<ReminderRecord> = {}): ReminderRecord => ({
  body: null,
  created_at: NOW,
  enabled: true,
  id: ID,
  link: null,
  not_before: new Date('2026-11-01T00:00:00Z'),
  time_of_day: '20:00',
  title: 'Evening questionnaire',
  updated_at: NOW,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  ...overrides,
})

const setup = () => {
  const store = new Map([[ID, record()]])
  const deps: ReminderDeps = {
    delete: async (_user, id) => store.delete(id),
    get: async (_user, id) => store.get(id) ?? null,
    getTimezone: async () => 'UTC',
    insert: async (_user, input) => {
      const row = record({ ...input, body: input.body ?? null, id: '2'.repeat(8) + ID.slice(8), link: null })
      store.set(row.id, row)
      return row
    },
    list: async () => [...store.values()],
    markRead: async () => 0,
    now: () => NOW,
    raise: async () => {},
    update: async (_user, id, patch) => {
      const existing = store.get(id)
      if (!existing) return null
      const next = { ...existing, ...patch } as ReminderRecord
      store.set(id, next)
      return next
    },
  }
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _description: string, _shape: unknown, handler: ToolHandler) =>
      tools.set(name, handler),
  } as unknown as McpServer
  registerReminderTools(server, 'alice', deps)
  const call = async (name: string, params: Record<string, unknown> = {}) =>
    (await tools.get(name)!(params)).content[0]!.text
  return { call, store, tools }
}

describe('reminder MCP tools', () => {
  test('registers the four tools', () => {
    expect([...setup().tools.keys()].sort()).toEqual([
      'add_reminder',
      'delete_reminder',
      'list_reminders',
      'update_reminder',
    ])
  })

  test('list_reminders answers like GET /reminders', async () => {
    const answer = JSON.parse(await setup().call('list_reminders'))
    expect(answer).toMatchObject({ next_due_at: '2026-11-18T20:00:00.000Z', success: true, timezone: 'UTC' })
  })

  test('add_reminder applies the body schema and its defaults', async () => {
    const { call } = setup()
    const added = JSON.parse(await call('add_reminder', { time_of_day: '07:30', title: 'Stretch' }))
    expect(added.reminder).toMatchObject({
      enabled: true,
      time_of_day: '07:30',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    })
    expect(await call('add_reminder', { time_of_day: '07:31', title: 'x' })).toContain('five-minute')
  })

  test('update_reminder needs a field and a known id', async () => {
    const { call } = setup()
    expect(await call('update_reminder', { id: ID })).toContain('at least one field')
    expect(await call('update_reminder', { id: 'nope', title: 'x' })).toBe('Reminder not found')
    expect(JSON.parse(await call('update_reminder', { enabled: false, id: ID })).reminder.enabled).toBe(false)
  })

  test('delete_reminder', async () => {
    const { call, store } = setup()
    expect(JSON.parse(await call('delete_reminder', { id: ID }))).toEqual({ success: true })
    expect(store.size).toBe(0)
    expect(await call('delete_reminder', { id: ID })).toBe('Reminder not found')
  })
})
