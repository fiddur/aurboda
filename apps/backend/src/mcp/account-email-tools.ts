import { updateAccountEmailBodySchema } from '@aurboda/api-spec'

import { type AccountEmailDb, getAccountEmail, setAccountEmail } from '../services/account-email.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerAccountEmailTools = (server: McpServer, user: string, centralDb: AccountEmailDb) => {
  server.tool(
    'get_my_email',
    "Get your account's email address, or null when none is set. It is private: only you and the server's admins see it, and it is never public or federated.",
    {},
    async () => jsonResponse({ email: await getAccountEmail(centralDb, user), success: true }),
  )

  server.tool(
    'set_my_email',
    "Set or clear your account's email address (null or an empty string clears it). It is private: only you and the server's admins see it, and it is never public or federated. Nothing sends email to it yet; it is meant for account recovery and plan reminders.",
    { ...updateAccountEmailBodySchema.shape },
    async ({ email }) => {
      const result = await setAccountEmail(centralDb, user, email)
      return result.ok ? jsonResponse({ email: result.email, success: true }) : errorResponse(result.error)
    },
  )
}
