import { deleteAccountBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import type { AccountDeleter } from '../services/account-deletion.ts'
import type { CentralDb } from '../services/central-db.ts'

import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerAccountDeletionTools = (
  server: McpServer,
  user: string,
  centralDb: CentralDb,
  deleteAccount: AccountDeleter,
) => {
  server.tool(
    'delete_my_account',
    'Permanently delete your own account: all data, integration grants and the public profile; followers on other servers are told the account is gone, and the username can never be used again. Irreversible — run export_data_dump first to keep a copy. `confirm_username` must be your username. The last admin cannot be deleted.',
    { ...deleteAccountBodySchema.shape },
    async ({ confirm_username }) => {
      const result = await deleteAccount(user, { actor: user, confirmUsername: confirm_username })
      if (!result.ok) return errorResponse(result.message)
      return jsonResponse({ success: true })
    },
  )

  server.tool(
    'delete_user',
    "Permanently delete another user's account, as delete_my_account does for oneself. Irreversible — the user should run export_data_dump first. `confirm_username` must repeat `username`. The last admin cannot be deleted. Running it again for a deletion that failed part-way finishes it. Admin-only.",
    {
      username: z.string().min(1).describe('Username of the account to delete'),
      ...deleteAccountBodySchema.shape,
    },
    async ({ username, confirm_username }) => {
      if (!(await centralDb.isAdmin(user))) return errorResponse('Admin permission required')
      const result = await deleteAccount(username, { actor: user, confirmUsername: confirm_username })
      if (!result.ok) return errorResponse(result.message)
      return jsonResponse({ success: true })
    },
  )
}
