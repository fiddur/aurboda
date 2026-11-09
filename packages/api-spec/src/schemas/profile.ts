import { z } from 'zod'

import { baseResponseSchema } from './common.ts'

export const DISPLAY_NAME_MAX_LENGTH = 100
export const EMAIL_MAX_LENGTH = 254

/** C0/C1 controls (tab and newline included), bidi embeddings and overrides, and bidi isolates. */
const CONTROL_OR_BIDI_CHARACTERS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u

export const hasControlOrBidiCharacters = (value: string): boolean => CONTROL_OR_BIDI_CHARACTERS.test(value)

/** Trimmed; an empty string means none, as null does. */
export const displayNameInputSchema = z
  .string()
  .trim()
  .max(DISPLAY_NAME_MAX_LENGTH, `Display name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters`)
  .refine((value) => !hasControlOrBidiCharacters(value), {
    message: 'Display name must not contain control or bidirectional formatting characters',
  })
  .meta({
    description:
      'Name shown on your profile and posts, in the feed and to followers on other servers (at most 100 characters, no control or bidirectional formatting characters; empty for none)',
    example: 'Fredrik Liljegren',
  })

const emailFormatSchema = z.email()

/** Trimmed, case kept as typed; an empty string means none, as null does. */
export const emailInputSchema = z
  .string()
  .trim()
  .max(EMAIL_MAX_LENGTH, `Email must be at most ${EMAIL_MAX_LENGTH} characters`)
  .refine((value) => value === '' || emailFormatSchema.safeParse(value).success, {
    message: 'Not a valid email address',
  })
  .meta({
    description:
      'Email address, private: only you and the server admins see it, it is never public or federated (empty for none)',
    example: 'me@example.com',
  })

/** A trimmed optional text field as stored: an empty string clears it, as null does. */
export const blankToNull = <T extends string | null | undefined>(value: T): T | null =>
  typeof value === 'string' && value.trim() === '' ? null : value

export const accountEmailResponseSchema = baseResponseSchema
  .extend({
    email: z.string().nullable().meta({
      description: 'Your email address; null when none is set. Only you and the server admins see it.',
    }),
  })
  .meta({
    description: "The authenticated user's private email address",
    id: 'AccountEmailResponse',
  })

export type AccountEmailResponse = z.infer<typeof accountEmailResponseSchema>

export const updateAccountEmailBodySchema = z
  .object({
    email: emailInputSchema.nullable(),
  })
  .meta({
    description:
      'Set or clear your email address (null or an empty string clears it). It is private: only you and the server admins see it. Nothing is sent to it yet.',
    id: 'UpdateAccountEmailBody',
  })

export type UpdateAccountEmailBody = z.infer<typeof updateAccountEmailBodySchema>

/** The optional profile fields a signup may carry. */
export const signupProfileShape = {
  display_name: displayNameInputSchema.optional(),
  email: emailInputSchema.optional(),
}

export const signupProfileSchema = z.object(signupProfileShape)

export type SignupProfile = z.infer<typeof signupProfileSchema>
