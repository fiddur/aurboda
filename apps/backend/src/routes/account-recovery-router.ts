import {
  type BaseResponse,
  RECOVERY_REQUEST_MESSAGE,
  type RecoveryCompleteBody,
  recoveryCompleteBodySchema,
  type RecoveryCompleteResponse,
  type RecoveryRequestBody,
  recoveryRequestBodySchema,
  type RecoveryRequestResponse,
  type VerifyEmailBody,
  verifyEmailBodySchema,
} from '@aurboda/api-spec'

import type { AccountRecovery } from '../services/account-recovery.ts'

import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const INVALID_LINK_ERROR = 'This link is invalid, already used or expired'

/**
 * The public targets of the emailed links, mounted at `/account`. REST only, like `/login`: the
 * token in the link is the credential. Rate-limited per client IP by `mountRateLimits`.
 */
export const createAccountRecoveryRouter = (recovery: AccountRecovery): TypedRouter => {
  const router = typedRouter()

  router.post<Record<string, never>, BaseResponse, VerifyEmailBody>(
    '/email/verify',
    validateBody(verifyEmailBodySchema),
    async (req, res) => {
      if (!(await recovery.verifyEmail(req.body.token))) {
        return res.status(400).json({ error: INVALID_LINK_ERROR, success: false })
      }
      res.json({ success: true })
    },
  )

  router.post<Record<string, never>, RecoveryRequestResponse, RecoveryRequestBody>(
    '/recovery/request',
    validateBody(recoveryRequestBodySchema),
    (req, res) => {
      res.json({ message: RECOVERY_REQUEST_MESSAGE, success: true })
      void recovery.requestRecovery(req.body.identifier)
    },
  )

  router.post<Record<string, never>, RecoveryCompleteResponse | BaseResponse, RecoveryCompleteBody>(
    '/recovery/complete',
    validateBody(recoveryCompleteBodySchema),
    async (req, res) => {
      const result = await recovery.completeRecovery(req.body.token, req.body.new_password)
      if (!result.ok) return res.status(400).json({ error: INVALID_LINK_ERROR, success: false })
      res.json({ is_admin: result.is_admin, token: result.token, username: result.username })
    },
  )

  return router
}
