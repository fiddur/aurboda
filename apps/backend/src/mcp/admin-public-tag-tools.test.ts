import { describe, expect, test, vi } from 'vitest'

import type { CentralDb } from '../services/central-db.ts'
import type { PublicTagModeration } from '../services/public-tag-moderation.ts'
import type { McpServer } from './helpers.ts'

import { registerAdminPublicTagTools } from './admin-public-tag-tools.ts'

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: { text: string }[] }>

const ID = '11111111-1111-4111-8111-111111111111'
const hidden = {
  actor_uri: 'https://spam.example/users/x',
  hidden_at: '2026-11-15T00:00:00.000Z',
  hidden_by: 'fiddur',
  id: ID,
  note_uri: 'https://spam.example/notes/1',
}
const block = {
  created_at: '2026-11-15T00:00:00.000Z',
  created_by: 'fiddur',
  id: ID,
  kind: 'domain' as const,
  value: 'spam.example',
}

const setup = (isAdmin: boolean) => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  const moderation: PublicTagModeration = {
    addBlock: vi.fn(async (input) =>
      input.value === 'dupe.example'
        ? { error: 'Already blocked', ok: false as const, status: 409 as const }
        : { block, ok: true as const, removed_posts: 2 },
    ),
    hide: vi.fn(async (id: string) => (id === ID ? hidden : null)),
    listBlocks: vi.fn(async () => [block]),
    listHidden: vi.fn(async () => [hidden]),
    removeBlock: vi.fn(async (id: string) => id === ID),
    unhide: vi.fn(async (id: string) => id === ID),
  }
  const centralDb = { isAdmin: vi.fn(async () => isAdmin) } as unknown as CentralDb
  registerAdminPublicTagTools(server, 'fiddur', centralDb, moderation)
  const call = async (name: string, params: Record<string, unknown> = {}) => {
    const handler = tools.get(name)
    if (handler == null) throw new Error(`no tool ${name}`)
    return handler(params)
  }
  return { call, moderation, tools }
}

const body = (result: { content: { text: string }[] }) => JSON.parse(result.content[0].text) as unknown

describe('admin public tag tools', () => {
  test('registers the six moderation tools', () => {
    expect([...setup(true).tools.keys()].sort()).toEqual([
      'add_public_tag_block',
      'hide_public_tag_post',
      'list_hidden_public_tag_posts',
      'list_public_tag_blocks',
      'remove_public_tag_block',
      'unhide_public_tag_post',
    ])
  })

  test('refuses every tool to a non-admin without touching the moderation', async () => {
    const { call, moderation } = setup(false)
    for (const [name, params] of [
      ['hide_public_tag_post', { id: ID }],
      ['list_hidden_public_tag_posts', {}],
      ['unhide_public_tag_post', { id: ID }],
      ['list_public_tag_blocks', {}],
      ['add_public_tag_block', { kind: 'domain', value: 'spam.example' }],
      ['remove_public_tag_block', { id: ID }],
    ] as const) {
      expect((await call(name, params)).content[0].text).toContain('Admin permission required')
    }
    for (const fn of Object.values(moderation)) expect(fn).not.toHaveBeenCalled()
  })

  test('hide_public_tag_post hides as the calling admin', async () => {
    const { call, moderation } = setup(true)
    expect(body(await call('hide_public_tag_post', { id: ID }))).toEqual({ hidden, success: true })
    expect(moderation.hide).toHaveBeenCalledWith(ID, 'fiddur')
    const missing = await call('hide_public_tag_post', { id: '22222222-2222-4222-8222-222222222222' })
    expect(missing.content[0].text).toBe('Post not found on the tag pages')
  })

  test('add_public_tag_block returns the block and the removed count, or the refusal', async () => {
    const { call, moderation } = setup(true)
    expect(body(await call('add_public_tag_block', { kind: 'domain', value: 'spam.example' }))).toEqual({
      block,
      removed_posts: 2,
      success: true,
    })
    expect(moderation.addBlock).toHaveBeenCalledWith({ kind: 'domain', value: 'spam.example' }, 'fiddur')
    const dupe = await call('add_public_tag_block', { kind: 'domain', value: 'dupe.example' })
    expect(dupe.content[0].text).toBe('Already blocked')
  })

  test('lists, unhides and unblocks', async () => {
    const { call } = setup(true)
    expect(body(await call('list_hidden_public_tag_posts'))).toEqual({ hidden: [hidden], success: true })
    expect(body(await call('list_public_tag_blocks'))).toEqual({ blocks: [block], success: true })
    expect(body(await call('unhide_public_tag_post', { id: ID }))).toEqual({ success: true })
    expect(body(await call('remove_public_tag_block', { id: ID }))).toEqual({ success: true })
    const other = '33333333-3333-4333-8333-333333333333'
    expect((await call('unhide_public_tag_post', { id: other })).content[0].text).toBe('Not hidden')
    expect((await call('remove_public_tag_block', { id: other })).content[0].text).toBe('Block not found')
  })
})
