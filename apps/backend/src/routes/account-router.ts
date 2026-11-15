import {
  type AccountEmailResponse,
  type AccountPlanResponse,
  type BaseResponse,
  type DeleteAccountBody,
  deleteAccountBodySchema,
  type SendEmailVerificationResponse,
  type UpdateAccountEmailBody,
  updateAccountEmailBodySchema,
} from '@aurboda/api-spec'

import type { AccountDeleter } from '../services/account-deletion.ts'
import type { AccountPlans } from '../services/account-plan.ts'
import type { VerificationSendResult } from '../services/account-recovery.ts'

import { accountDeletionStatus } from '../services/account-deletion.ts'
import { type AccountEmailDeps, getAccountEmail, setAccountEmail } from '../services/account-email.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

const VERIFICATION_FAILURES: Record<
  Exclude<VerificationSendResult, 'sent' | 'already_verified'>,
  [number, string]
> = {
  failed: [502, 'The verification mail could not be sent; try again later'],
  no_email: [400, 'No email address is set'],
  not_configured: [409, 'This server does not send email'],
  rate_limited: [429, 'Too many verification mails in the last hour; try again later'],
}

export const createAccountRouter = (
  authMiddleware: AnyMiddleware,
  deleteAccount: AccountDeleter,
  accountPlans?: Pick<AccountPlans, 'getMyPlan'>,
  accountEmail?: AccountEmailDeps,
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

  if (accountEmail) {
    router.get<Record<string, never>, AccountEmailResponse>('/email', authMiddleware, async (req, res) => {
      res.json({ ...(await getAccountEmail(accountEmail, req.user!)), success: true })
    })

    router.put<Record<string, never>, AccountEmailResponse | BaseResponse, UpdateAccountEmailBody>(
      '/email',
      authMiddleware,
      validateBody(updateAccountEmailBodySchema),
      async (req, res) => {
        const result = await setAccountEmail(accountEmail, req.user!, req.body.email)
        if (!result.ok) return res.status(409).json({ error: result.error, success: false })
        const { email, email_enabled, verified } = result
        res.json({ email, email_enabled, success: true, verified })
      },
    )

    router.post<Record<string, never>, SendEmailVerificationResponse | BaseResponse>(
      '/email/verification',
      authMiddleware,
      async (req, res) => {
        const result = await accountEmail.sendVerification(req.user!)
        if (result === 'sent' || result === 'already_verified') {
          return res.json({ status: result, success: true })
        }
        const [status, error] = VERIFICATION_FAILURES[result]
        res.status(status).json({ error, success: false })
      },
    )
  }

  return router
}
