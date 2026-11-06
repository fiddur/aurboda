import { updateUserPlanBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import type { AccountPlans } from '../services/account-plan.ts'
import type { CentralDb } from '../services/central-db.ts'

import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerAccountPlanTools = (
  server: McpServer,
  user: string,
  centralDb: Pick<CentralDb, 'isAdmin'>,
  accountPlans: AccountPlans,
) => {
  server.tool(
    'get_my_plan',
    "Get your account's billing plan and state: whether billing is enabled on this server, the plan (exempt, trial or paid), when it ends, when the account would become read-only, the price and where to pay. A read-only account can still read, export and delete its data, but stores nothing new until paid.",
    {},
    async () => jsonResponse({ success: true, ...(await accountPlans.getMyPlan(user)) }),
  )

  server.tool(
    'set_user_plan',
    "Change a user's plan (exempt, trial or paid), paid-until date, trial end or admin note. Payments are recorded by hand: set paid_until when the user has paid; a future paid_until on a trial account switches it to paid. Null clears a date or the note. Admin-only.",
    { username: z.string().min(1).describe('Username'), ...updateUserPlanBodySchema.shape },
    async ({ username, ...body }) => {
      if (!(await centralDb.isAdmin(user))) return errorResponse('Admin permission required')
      const status = await accountPlans.setUserPlan(username, body)
      if (!status) return errorResponse('User not found')
      return jsonResponse({ status, success: true })
    },
  )
}
