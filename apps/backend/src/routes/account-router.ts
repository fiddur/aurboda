import {
  type AccountPlanResponse,
  type BaseResponse,
  type DeleteAccountBody,
  deleteAccountBodySchema,
} from '@aurboda/api-spec'

import type { AccountDeleter } from '../services/account-deletion.ts'
import type { AccountPlans } from '../services/account-plan.ts'

import { accountDeletionStatus } from '../services/account-deletion.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createAccountRouter = (
  authMiddleware: AnyMiddleware,
  deleteAccount: AccountDeleter,
  accountPlans?: Pick<AccountPlans, 'getMyPlan'>,
): TypedRouter => {
  const router = typedRouter()

  router.delete<Record<string, never>, BaseResponse, DeleteAccountBody>(
    '/',
    authMiddleware,
    validateBody(deleteAccountBodySchema),
    async (req, res) => {
      const user = req.user!
      const result = await deleteAccount(user, { actor: user, confirmUsername: req.body.confirm_username })
      if (!result.ok) {
        res.status(accountDeletionStatus[result.error]).json({ error: result.message, success: false })
        return
      }
      res.json({ success: true })
    },
  )

  if (accountPlans) {
    router.get<Record<string, never>, AccountPlanResponse>('/plan', authMiddleware, async (req, res) => {
      res.json({ success: true, ...(await accountPlans.getMyPlan(req.user!)) })
    })
  }

  return router
}
