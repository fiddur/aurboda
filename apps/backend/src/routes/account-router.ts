import {
  type AccountEmailResponse,
  type AccountPlanResponse,
  type BaseResponse,
  type DeleteAccountBody,
  deleteAccountBodySchema,
  type UpdateAccountEmailBody,
  updateAccountEmailBodySchema,
} from '@aurboda/api-spec'

import type { AccountDeleter } from '../services/account-deletion.ts'
import type { AccountPlans } from '../services/account-plan.ts'

import { accountDeletionStatus } from '../services/account-deletion.ts'
import { type AccountEmailDb, getAccountEmail, setAccountEmail } from '../services/account-email.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createAccountRouter = (
  authMiddleware: AnyMiddleware,
  deleteAccount: AccountDeleter,
  accountPlans?: Pick<AccountPlans, 'getMyPlan'>,
  accountEmailDb?: AccountEmailDb,
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

  if (accountEmailDb) {
    router.get<Record<string, never>, AccountEmailResponse>('/email', authMiddleware, async (req, res) => {
      res.json({ email: await getAccountEmail(accountEmailDb, req.user!), success: true })
    })

    router.put<Record<string, never>, AccountEmailResponse, UpdateAccountEmailBody>(
      '/email',
      authMiddleware,
      validateBody(updateAccountEmailBodySchema),
      async (req, res) => {
        const result = await setAccountEmail(accountEmailDb, req.user!, req.body.email)
        if (!result.ok) return res.status(409).json({ email: null, error: result.error, success: false })
        res.json({ email: result.email, success: true })
      },
    )
  }

  return router
}
