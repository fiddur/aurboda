import type { PostUpdateResender } from '../services/activitypub/post-update-resend.ts'
import type { CentralDb } from '../services/central-db.ts'

import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerAdminFederationTools = (
  server: McpServer,
  user: string,
  centralDb: CentralDb,
  postUpdates: PostUpdateResender,
) => {
  server.tool(
    'resend_post_updates',
    "Re-send the Update of every public and unlisted post of every user on this server, so remote servers refresh their copy (such as the quote policy Mastodon cached as 'nobody' for posts federated before it was declared). Only Updates are sent, so repeating it is harmless. Returns how many posts are queued; they are delivered one after another in the background. Admin-only.",
    {},
    async () => {
      if (!(await centralDb.isAdmin(user))) return errorResponse('Admin permission required')
      const run = await postUpdates.start()
      if (run == null) return errorResponse('A re-send is already running')
      return jsonResponse({ posts: run.posts, success: true })
    },
  )
}
