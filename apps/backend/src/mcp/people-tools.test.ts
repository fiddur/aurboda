import { describe, expect, test } from 'vitest'

import type { McpServer } from './helpers.ts'

import { fakePeopleDeps } from '../test/fake-people-deps.ts'
import { registerPeopleTools } from './people-tools.ts'

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>

const setup = () => {
  const fake = fakePeopleDeps()
  fake.actors.set('@anna@example.social', {
    actor_uri: 'https://example.social/users/anna',
    handle: '@anna@example.social',
    icon: null,
    name: 'Anna',
  })
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _description: string, _shape: unknown, handler: ToolHandler) =>
      tools.set(name, handler),
  } as unknown as McpServer
  registerPeopleTools(server, 'alice', fake.deps)
  const call = async (name: string, params: Record<string, unknown> = {}) => {
    const result = await tools.get(name)!(params)
    const text = result.content[0]!.text
    return result.isError ? { error: text } : JSON.parse(text)
  }
  return { call, fake, tools }
}

describe('people tools', () => {
  test('registers the people tools', () => {
    expect([...setup().tools.keys()].sort()).toEqual([
      'add_person',
      'add_person_date',
      'delete_person',
      'delete_person_date',
      'get_person',
      'list_important_dates',
      'list_people',
      'list_person_posts',
      'restore_person',
      'update_person',
      'update_person_date',
    ])
  })

  test('add, list, get, update, delete and restore a person', async () => {
    const { call } = setup()
    const { person } = await call('add_person', { handle: '@anna@example.social', name: 'Anna' })
    expect(person.actor.uri).toBe('https://example.social/users/anna')
    expect((await call('list_people')).people).toHaveLength(1)
    expect((await call('get_person', { id: person.id })).person).toMatchObject({
      dates: [],
      journal_entries: [],
      name: 'Anna',
    })
    expect(
      (await call('update_person', { id: person.id, relationship: 'sibling' })).person.relationship,
    ).toBe('sibling')
    expect(await call('delete_person', { id: person.id })).toEqual({ success: true })
    expect((await call('list_people', { deleted: true })).people).toHaveLength(1)
    expect((await call('restore_person', { id: person.id })).person.id).toBe(person.id)
    expect(await call('delete_person', { id: person.id, purge: true })).toEqual({ success: true })
    expect(await call('get_person', { id: person.id })).toEqual({
      error: expect.stringContaining('not found'),
    })
  })

  test('refuses invalid input and an unresolvable handle', async () => {
    const { call } = setup()
    expect(await call('add_person', { name: '' })).toHaveProperty('error')
    expect(await call('add_person', { handle: '@x@nowhere', name: 'X' })).toEqual({
      error: expect.stringContaining('Could not resolve'),
    })
    const { person } = await call('add_person', { name: 'Bo' })
    expect(await call('update_person', { id: person.id })).toHaveProperty('error')
    expect(await call('list_person_posts', { id: person.id })).toHaveProperty('error')
  })

  test('dates and the important dates', async () => {
    const { call } = setup()
    const { person } = await call('add_person', { birth_date: '1990-12-24', name: 'Anna' })
    const { date } = await call('add_person_date', {
      day: 1,
      kind: 'anniversary',
      label: 'Wedding',
      month: 12,
      person_id: person.id,
    })
    expect(
      (await call('update_person_date', { date_id: date.id, notify_days_before: 3, person_id: person.id }))
        .date.notify_days_before,
    ).toBe(3)
    const listed = await call('list_important_dates', { from: '2026-12-01', to: '2026-12-31' })
    expect(listed.dates.map((d: { label: string }) => d.label)).toEqual(['Wedding', "Anna's birthday"])
    expect(await call('delete_person_date', { date_id: date.id, person_id: person.id })).toEqual({
      success: true,
    })
    expect(
      await call('add_person_date', { day: 30, label: 'x', month: 2, person_id: person.id }),
    ).toHaveProperty('error')
  })
})
