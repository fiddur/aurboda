import type { PostUpdateResender } from '../services/activitypub/post-update-resend.ts'
import type { CentralDb } from '../services/central-db.ts'

import { listFederationDeliveryFailures } from '../services/central-federation-delivery.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerAdminFederationTools = (
  server: McpServer,
  user: string,
  centralDb: CentralDb,
  postUpdates: PostUpdateResender,
) => {
  server.tool(
    'resend_post_updates',
    "Re-send the Update of every public and unlisted post of every user on this server, so remote servers refresh their copy (such as the quote policy Mastodon cached as 'nobody' for posts federated before it was declared). Only Updates are sent, so repeating it is harmless. Returns how many posts are queued; they are handed to delivery one after another in the background, where a failed inbox is retried. Admin-only.",
    {},
    async () => {
      if (!(await centralDb.isAdmin(user))) return errorResponse('Admin permission required')
      const run = await postUpdates.start()
      if (run == null) return errorResponse('A re-send is already running')
      return jsonResponse({ posts: run.posts, success: true })
    },
  )
}

export const registerFederationDeliveryTools = (server: McpServer, user: string, centralDb: CentralDb) => {
  server.tool(
    'list_federation_delivery_failures',
    'List the remote servers whose inboxes the outbound delivery queue could not reach, most recent failure first: host, latest inbox, latest HTTP status (null when no answer came) and status line, failed attempts since the last accepted delivery, and when it first and last failed. A server leaves the list once it accepts a delivery again. Recorded only while deliveries are queued. Admin-only.',
    {},
    async () => {
      if (!(await centralDb.isAdmin(user))) return errorResponse('Admin permission required')
      return jsonResponse({ failures: await listFederationDeliveryFailures(centralDb), success: true })
    },
  )
}
