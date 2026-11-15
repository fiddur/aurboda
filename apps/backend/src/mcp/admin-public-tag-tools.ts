import { addPublicTagBlockBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import type { CentralDb } from '../services/central-db.ts'
import type { PublicTagModeration } from '../services/public-tag-moderation.ts'

import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerAdminPublicTagTools = (
  server: McpServer,
  user: string,
  centralDb: CentralDb,
  moderation: PublicTagModeration,
) => {
  const requireAdmin = async (): Promise<string | null> =>
    (await centralDb.isAdmin(user)) ? null : 'Admin permission required'

  server.tool(
    'hide_public_tag_post',
    'Hide one post from the public tag pages and the official feed: it is removed, and a later Announce or edit of it is not stored again. Takes the post id as list_public_tag_posts lists it. Admin-only.',
    { id: z.string().uuid().describe('The post id, from the tag page listing') },
    async ({ id }) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      const hidden = await moderation.hide(id, user)
      if (hidden == null) return errorResponse('Post not found on the tag pages')
      return jsonResponse({ hidden, success: true })
    },
  )

  server.tool(
    'list_hidden_public_tag_posts',
    'List the posts hidden from the public tag pages, newest first, at most 200. Admin-only.',
    {},
    async () => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      return jsonResponse({ hidden: await moderation.listHidden(), success: true })
    },
  )

  server.tool(
    'unhide_public_tag_post',
    'Stop hiding a post on the public tag pages. Nothing is fetched back: the post returns when it is announced or edited again. Admin-only.',
    { id: z.string().uuid().describe('Id of the hide, from list_hidden_public_tag_posts') },
    async ({ id }) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      if (!(await moderation.unhide(id))) return errorResponse('Not hidden')
      return jsonResponse({ success: true })
    },
  )

  server.tool(
    'list_public_tag_blocks',
    'List the authors and domains kept off the public tag pages and the official feed, newest first. Admin-only.',
    {},
    async () => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      return jsonResponse({ blocks: await moderation.listBlocks(), success: true })
    },
  )

  server.tool(
    'add_public_tag_block',
    "Keep an author (kind actor, value the actor URI) or a domain and its subdomains (kind domain, value e.g. example.org) off the public tag pages and the official feed. The posts it matches are removed at once and new ones are not stored; the author's own feed and federation are untouched. This server's own host cannot be blocked. Admin-only.",
    { ...addPublicTagBlockBodySchema.shape },
    async (params) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      const result = await moderation.addBlock(params, user)
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse({ block: result.block, removed_posts: result.removed_posts, success: true })
    },
  )

  server.tool(
    'remove_public_tag_block',
    'Remove a block from the public tag pages. Nothing is fetched back: posts return as they are announced or edited again. Admin-only.',
    { id: z.string().uuid().describe('Block id, from list_public_tag_blocks') },
    async ({ id }) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      if (!(await moderation.removeBlock(id))) return errorResponse('Block not found')
      return jsonResponse({ success: true })
    },
  )
}
