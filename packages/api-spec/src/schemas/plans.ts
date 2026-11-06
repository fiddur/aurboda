import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema } from './common.ts'

export const accountPlans = ['exempt', 'trial', 'paid'] as const

export const accountPlanSchema = z.enum(accountPlans).meta({
  description:
    'Billing plan of an account: exempt (never restricted), trial (free until trial_ends_at) or paid (paid until paid_until)',
  id: 'AccountPlan',
})

export type AccountPlan = z.infer<typeof accountPlanSchema>

export const accountStates = ['active', 'trial', 'grace', 'read_only'] as const

export const accountStateSchema = z.enum(accountStates).meta({
  description:
    'Where an account stands: active (no restriction), trial (in the free trial), grace (expired, within the grace period) or read_only (expired past the grace period: no new data is stored until paid)',
  id: 'AccountState',
})

export type AccountState = z.infer<typeof accountStateSchema>

export const accountPlanStatusShape = {
  ends_at: iso8601DateTimeSchema.nullable().meta({
    description: 'When the trial or paid period ends (the later of the two); null when it never does',
  }),
  plan: accountPlanSchema
    .nullable()
    .meta({ description: 'The plan; null for an account billing has never applied to' }),
  read_only_at: iso8601DateTimeSchema.nullable().meta({
    description: 'When the account becomes read-only (ends_at plus the grace period); null when never',
  }),
  state: accountStateSchema,
}

export const accountPlanResponseSchema = baseResponseSchema
  .extend({
    ...accountPlanStatusShape,
    billing_enabled: z.boolean().meta({ description: 'Whether this server charges for accounts at all' }),
    expiring_soon: z.boolean().meta({ description: 'Whether the trial or paid period ends within 14 days' }),
    payment_url: z
      .string()
      .nullable()
      .meta({ description: 'Where to pay (e.g. a Patreon page); null when not configured' }),
    price_text: z
      .string()
      .nullable()
      .meta({ description: 'The price as the admin wrote it, e.g. "3 € / month"; null when not configured' }),
  })
  .meta({
    description: "The authenticated user's plan and billing state",
    id: 'AccountPlanResponse',
  })

export type AccountPlanResponse = z.infer<typeof accountPlanResponseSchema>

export const updateUserPlanBodySchema = z
  .object({
    paid_until: iso8601DateTimeSchema.nullable().optional().meta({
      description:
        'Paid until this time (null to clear). A future date on a trial account switches it to the paid plan.',
    }),
    plan: accountPlanSchema.optional(),
    plan_note: z
      .string()
      .max(1000)
      .nullable()
      .optional()
      .meta({ description: 'Free-text admin note, e.g. how the user pays (null to clear)' }),
    trial_ends_at: iso8601DateTimeSchema
      .nullable()
      .optional()
      .meta({ description: 'When the free trial ends (null to clear)' }),
  })
  .meta({
    description:
      "Change a user's plan. Payments are recorded by hand: set paid_until when the user has paid.",
    id: 'UpdateUserPlanBody',
  })

export type UpdateUserPlanBody = z.infer<typeof updateUserPlanBodySchema>

export const adminUserPlanShape = {
  ...accountPlanStatusShape,
  paid_until: iso8601DateTimeSchema.nullable().meta({ description: 'Paid until this time' }),
  plan_note: z.string().nullable().meta({ description: 'Admin note' }),
  trial_ends_at: iso8601DateTimeSchema.nullable().meta({ description: 'When the free trial ends' }),
}

export const adminUserPlanSchema = z
  .object(adminUserPlanShape)
  .meta({ description: "A user's plan, as an admin sees it", id: 'AdminUserPlan' })

export type AdminUserPlan = z.infer<typeof adminUserPlanSchema>

export const adminUserPlanResponseSchema = baseResponseSchema
  .extend({
    status: adminUserPlanSchema.optional().meta({ description: "The user's updated plan; absent on error" }),
  })
  .meta({ id: 'AdminUserPlanResponse' })

export type AdminUserPlanResponse = z.infer<typeof adminUserPlanResponseSchema>

export const accountReadOnlyResponseSchema = baseResponseSchema
  .extend({
    error: z.string().meta({ description: 'Why the write was refused' }),
    payment_url: z
      .string()
      .nullable()
      .meta({ description: 'Where to pay to lift the restriction; null when not configured' }),
  })
  .meta({
    description:
      'Answer (HTTP 402) to a write by an account whose plan expired past the grace period. Reading, exporting and deleting the account still work.',
    id: 'AccountReadOnlyResponse',
  })

export type AccountReadOnlyResponse = z.infer<typeof accountReadOnlyResponseSchema>
