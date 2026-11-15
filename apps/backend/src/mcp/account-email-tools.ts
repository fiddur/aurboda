import { updateAccountEmailBodySchema } from '@aurboda/api-spec'

import { type AccountEmailDeps, getAccountEmail, setAccountEmail } from '../services/account-email.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const VERIFICATION_ERRORS = {
  failed: 'The verification mail could not be sent; try again later.',
  no_email: 'No email address is set.',
  not_configured: 'This server does not send email.',
  rate_limited: 'Too many verification mails in the last hour; try again later.',
} as const

export const registerAccountEmailTools = (server: McpServer, user: string, deps: AccountEmailDeps) => {
  server.tool(
    'get_my_email',
    "Get your account's email address (null when none is set), whether it is verified, and whether this server sends email (email_enabled). It is private: only you and the server's admins see it, and it is never public or federated.",
    {},
    async () => jsonResponse({ ...(await getAccountEmail(deps, user)), success: true }),
  )

  server.tool(
    'set_my_email',
    "Set or clear your account's email address (null or an empty string clears it). It is private: only you and the server's admins see it, and it is never public or federated. A new address is unverified: when the server sends email, a verification link goes to it, and only a verified address is used for password reset and account recovery.",
    { ...updateAccountEmailBodySchema.shape },
    async ({ email }) => {
      const result = await setAccountEmail(deps, user, email)
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse({
        email: result.email,
        email_enabled: result.email_enabled,
        success: true,
        verified: result.verified,
      })
    },
  )

  server.tool(
    'send_email_verification',
    "Send a new verification link to your account's email address (valid 24 hours; it replaces any earlier link). At most 3 verification mails an hour. Does nothing when the address is already verified.",
    {},
    async () => {
      const status = await deps.sendVerification(user)
      if (status === 'sent' || status === 'already_verified') return jsonResponse({ status, success: true })
      return errorResponse(VERIFICATION_ERRORS[status])
    },
  )
}
