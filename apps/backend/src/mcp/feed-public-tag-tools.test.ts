import { describe, expect, test, vi } from 'vitest'

import type { PublicTagActions } from '../services/public-tags.ts'
import type { McpServer } from './helpers.ts'

import { registerFeedTools } from './feed-tools.ts'

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: { text: string }[]; isError?: boolean }>

const setup = (publicTagActions?: Pick<PublicTagActions, 'page'>) => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  registerFeedTools(server, 'fiddur', { publicTagActions })
  const handler = tools.get('list_public_tag_posts')
  if (handler == null) throw new Error('no list_public_tag_posts')
  return handler
}

describe('list_public_tag_posts', () => {
  const page = vi.fn(async (tag: string, _cursor?: string) =>
    tag === 'aurboda'
      ? {
          ok: true as const,
          page: { next_cursor: null, posts: [], retention_days: 30, success: true, tag: 'aurboda' },
        }
      : { ok: false as const },
  )

  test('lists a configured tag’s page, passing the cursor on', async () => {
    const result = await setup({ page })({ cursor: 'abc', tag: 'aurboda' })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0].text)).toMatchObject({ retention_days: 30, tag: 'aurboda' })
    expect(page).toHaveBeenCalledWith('aurboda', 'abc')
  })

  test('reports a tag without a page, and every tag without the dependency', async () => {
    expect((await setup({ page })({ tag: 'running' })).content[0].text).toContain(
      'No public page for #running',
    )
    expect((await setup()({ tag: 'aurboda' })).content[0].text).toContain('No public page for #aurboda')
  })
})
