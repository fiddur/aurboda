import { z } from 'zod'

import { accountPasswordSchema, loginResponseSchema } from './admin.ts'
import { baseResponseSchema } from './common.ts'

const emailLinkTokenSchema = z
  .string()
  .min(1)
  .max(200)
  .meta({ description: 'The token from the emailed link', example: 'r4nd0m-t0k3n' })

export const verifyEmailBodySchema = z
  .object({ token: emailLinkTokenSchema })
  .meta({ description: 'Confirms an account email address by its emailed link', id: 'VerifyEmailBody' })

export type VerifyEmailBody = z.infer<typeof verifyEmailBodySchema>

export const recoveryRequestBodySchema = z
  .object({
    identifier: z.string().trim().min(1).max(254).meta({
      description: 'A username, or an email address (one with `@`)',
      example: 'alice',
    }),
  })
  .meta({ description: 'Asks for a password reset or passkey recovery link', id: 'RecoveryRequestBody' })

export type RecoveryRequestBody = z.infer<typeof recoveryRequestBodySchema>

export const RECOVERY_REQUEST_MESSAGE = 'If an account with a verified email matches, a link is on its way.'

export const recoveryRequestResponseSchema = baseResponseSchema
  .extend({
    message: z.string().meta({
      description: 'The same message whatever the identifier matched, so it tells no accounts apart',
      example: RECOVERY_REQUEST_MESSAGE,
    }),
  })
  .meta({ id: 'RecoveryRequestResponse' })

export type RecoveryRequestResponse = z.infer<typeof recoveryRequestResponseSchema>

export const recoveryCompleteBodySchema = z
  .object({
    new_password: accountPasswordSchema.optional().meta({
      description:
        'The new password. Leave it out to sign in without changing the password (for adding a new passkey)',
    }),
    token: emailLinkTokenSchema,
  })
  .meta({
    description: 'Uses a recovery link: sets a new password, or only signs in',
    id: 'RecoveryCompleteBody',
  })

export type RecoveryCompleteBody = z.infer<typeof recoveryCompleteBodySchema>

export const recoveryCompleteResponseSchema = loginResponseSchema
  .extend({ username: z.string().meta({ description: 'The account the link recovered' }) })
  .meta({
    description: "A recovery sign-in: `/login`'s answer, plus the username the link was for",
    id: 'RecoveryCompleteResponse',
  })

export type RecoveryCompleteResponse = z.infer<typeof recoveryCompleteResponseSchema>
