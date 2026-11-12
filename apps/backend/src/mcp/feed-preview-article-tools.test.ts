import { describe, expect, test, vi } from 'vitest'

import type { ArticlePreview, ArticlePreviewer } from '../services/article-preview.ts'
import type { McpServer } from './helpers.ts'

import { registerFeedTools } from './feed-tools.ts'

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: { text: string }[]; isError?: boolean }>

const setup = (previewArticle?: ArticlePreviewer) => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  registerFeedTools(server, 'alice', { previewArticle })
  const handler = tools.get('preview_article')
  if (handler == null) throw new Error('no preview_article')
  return handler
}

const PREVIEW: ArticlePreview = {
  attachments: [],
  content: '<p><strong>Coffee</strong></p>',
  mastodon: { attachment_limit: 4, content: '<p><strong>Coffee</strong></p>', hashtag_bar: ['coffee'] },
  name: 'Coffee',
  notes: [],
  publish_error: null,
  tags: ['coffee'],
}

describe('preview_article', () => {
  test('returns the preview for the given article, without a success wrapper', async () => {
    const previewArticle = vi.fn(async () => PREVIEW)
    const body = { article: { blocks: [], title: 'Coffee' }, visibility: 'public' }
    const result = await setup(previewArticle)(body)
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0].text)).toEqual(PREVIEW)
    expect(previewArticle).toHaveBeenCalledWith('alice', body)
  })

  test('reports unavailable without the dependency', async () => {
    const result = await setup()({ article: { blocks: [], title: 'Coffee' } })
    expect(result.content[0].text).toContain('Article preview is not available')
  })
})
