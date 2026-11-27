import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { McpServer } from './helpers.ts'

import { registerNoteTools } from './note-tools.ts'

vi.mock('../services/journal-context.ts', () => ({ getJournalContext: vi.fn(), withJournalContext: vi.fn() }))

vi.mock('../services/mutations.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getNoteForUser: vi.fn(),
}))

vi.mock('../services/settings.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserTimezone: vi.fn(async () => 'Europe/Stockholm'),
}))

const journalContext = await import('../services/journal-context.ts')
const mutations = await import('../services/mutations.ts')

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: { text: string }[]; isError?: boolean }>

const setup = () => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _description: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  registerNoteTools(server, 'alice')
  return (name: string, params: Record<string, unknown> = {}) => tools.get(name)!(params)
}

const body = (result: { content: { text: string }[] }) => JSON.parse(result.content[0].text)

const value = {
  decimals: 0,
  id: 'm',
  kind: 'moon' as const,
  label: '🌕',
  name: 'Moon illumination',
  suffix: '%',
  text: '🌕99%',
  value: 99.2,
}

const NOTE_ID = '9d0124e7-d161-4855-a54f-fa8bdb45c4f2'

describe('note tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('get_journal_context answers the line for the date and tz', async () => {
    vi.mocked(journalContext.getJournalContext).mockResolvedValue({ date: '2024-03-10', items: [value] })

    const result = await setup()('get_journal_context', { date: '2024-03-10', tz: 'UTC' })

    expect(body(result)).toEqual({ data: { date: '2024-03-10', items: [value] }, success: true })
    expect(journalContext.getJournalContext).toHaveBeenCalledWith('alice', '2024-03-10', 'UTC')
  })

  test("get_journal_context defaults to today in the user's timezone and to no items", async () => {
    vi.mocked(journalContext.getJournalContext).mockResolvedValue(undefined)
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date())

    const result = await setup()('get_journal_context')

    expect(body(result)).toEqual({ data: { date: today, items: [] }, success: true })
  })

  test('get_note carries the context line', async () => {
    const note = {
      content: 'A day',
      created_at: '2024-03-10T12:00:00.000Z',
      date: '2024-03-10',
      entity_id: null,
      entity_type: 'day' as const,
      id: NOTE_ID,
      tags: [],
      updated_at: '2024-03-10T12:00:00.000Z',
    }
    vi.mocked(mutations.getNoteForUser).mockResolvedValue({ data: note, success: true })
    vi.mocked(journalContext.withJournalContext).mockImplementation(async (_user, n) => ({
      ...n,
      context: { date: '2024-03-10', items: [value] },
    }))

    const result = await setup()('get_note', { id: NOTE_ID, tz: 'UTC' })

    expect(body(result).data.context).toEqual({ date: '2024-03-10', items: [value] })
    expect(journalContext.withJournalContext).toHaveBeenCalledWith('alice', note, 'UTC')
  })
})
