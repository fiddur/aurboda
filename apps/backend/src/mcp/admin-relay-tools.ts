import { addRelayBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import type { CentralDb } from '../services/central-db.ts'

import { type RelayActions, serializeRelay } from '../services/relays.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerAdminRelayTools = (
  server: McpServer,
  user: string,
  centralDb: CentralDb,
  relays: RelayActions,
) => {
  const requireAdmin = async (): Promise<string | null> =>
    (await centralDb.isAdmin(user)) ? null : 'Admin permission required'

  server.tool(
    'list_relays',
    'List the fediverse relays this server subscribes to, with their state (pending, accepted, rejected). Accepted relays receive the public posts of every user on this server. Admin-only.',
    {},
    async () => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      return jsonResponse({ relays: await relays.list(), success: true })
    },
  )

  server.tool(
    'add_relay',
    'Subscribe this server to a fediverse relay: the instance actor sends it a Follow, and once the relay accepts, the public posts of every user on this server are pushed to it. Style mastodon takes the relay inbox URL (e.g. https://tags.pub/user/_____relay_____/inbox); litepub takes the relay actor URL. Admin-only.',
    { ...addRelayBodySchema.shape },
    async (params) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      const result = await relays.add({ style: params.style ?? 'mastodon', url: params.url })
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse({ relay: serializeRelay(result.record), success: true })
    },
  )

  server.tool(
    'remove_relay',
    'Unsubscribe from a relay: sends it an Undo of the Follow and stops pushing posts to it. Admin-only.',
    { id: z.string().uuid().describe('Relay id, from list_relays') },
    async ({ id }) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      if (!(await relays.remove(id))) return errorResponse('Relay not found')
      return jsonResponse({ success: true })
    },
  )
}
