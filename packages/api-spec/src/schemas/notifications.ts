import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema, queryBooleanSchema } from './common.ts'

/**
 * Every kind of notification the server raises. Adding one is a registry entry
 * here plus a `raise` call where the event happens; nothing in the database
 * changes, since a stored notification's `type` is plain text.
 */
export const notificationTypes = ['admin_signup'] as const

export type NotificationType = (typeof notificationTypes)[number]

export const notificationTypeSchema = z.enum(notificationTypes).meta({
  description: 'A kind of notification. Each has its own in-app and push switches.',
  example: 'admin_signup',
  id: 'NotificationType',
})

export const isNotificationType = (value: string): value is NotificationType =>
  (notificationTypes as readonly string[]).includes(value)

export interface NotificationTypeInfo {
  label: string
  description: string
  /** Only admins receive it, and only admins see its settings row. */
  admin_only: boolean
}

export const notificationTypeInfo: Record<NotificationType, NotificationTypeInfo> = {
  admin_signup: {
    admin_only: true,
    description: 'Someone created an account on this server',
    label: 'New signups',
  },
}

export const notificationSchema = z
  .object({
    body: z.string().nullable().meta({ description: 'Longer text, if any' }),
    created_at: iso8601DateTimeSchema.meta({ description: 'When the notification was raised' }),
    data: z
      .record(z.string(), z.unknown())
      .nullable()
      .meta({ description: 'Type-specific details, e.g. `{ username }` for `admin_signup`' }),
    id: z.string().uuid().meta({ description: 'Notification ID' }),
    in_app: z.boolean().meta({ description: 'Shown under the bell (the type’s in-app switch when raised)' }),
    link: z
      .string()
      .nullable()
      .meta({ description: 'In-app path (starting with `/`) the notification opens, if any' }),
    push: z
      .boolean()
      .meta({ description: 'Delivered as a device push (the type’s push switch when raised)' }),
    read_at: iso8601DateTimeSchema
      .nullable()
      .meta({ description: 'When it was marked read, or null if unread' }),
    title: z.string().meta({ description: 'Short headline' }),
    type: z.string().meta({
      description:
        'One of the notification types (see `NotificationType`). Plain text so a client never fails to decode a type added after it was built.',
      example: 'admin_signup',
    }),
  })
  .meta({ description: 'A notification raised for the user', id: 'Notification' })

export type Notification = z.infer<typeof notificationSchema>

export const notificationsQuerySchema = z
  .object({
    after: iso8601DateTimeSchema.optional().meta({
      description: 'Only notifications created strictly after this time (a poller’s high-water mark)',
    }),
    cursor: z.string().optional().meta({ description: "Opaque cursor from a previous page's `next_cursor`" }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .meta({ description: 'Max notifications to return (1–100, default 20)' }),
    push_only: queryBooleanSchema.optional().meta({
      description:
        'List the notifications meant for push delivery (whatever their in-app switch) instead of the in-app ones',
    }),
    unread_only: queryBooleanSchema.optional().meta({ description: 'Only unread notifications' }),
  })
  .meta({ id: 'NotificationsQuery' })

export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>

export const notificationsResponseSchema = baseResponseSchema
  .extend({
    next_cursor: z
      .string()
      .nullable()
      .meta({ description: 'Cursor for the next page, or null if this is the last page' }),
    notifications: z.array(notificationSchema),
    unread_count: z
      .number()
      .int()
      .meta({ description: 'Unread in-app notifications in total, independent of the filters' }),
  })
  .meta({ id: 'NotificationsResponse' })

export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>

export const notificationResponseSchema = baseResponseSchema
  .extend({ notification: notificationSchema.optional() })
  .meta({ id: 'NotificationResponse' })

export type NotificationResponse = z.infer<typeof notificationResponseSchema>

export const markAllNotificationsReadResponseSchema = baseResponseSchema
  .extend({ updated: z.number().int().meta({ description: 'How many notifications were marked read' }) })
  .meta({ id: 'MarkAllNotificationsReadResponse' })

export type MarkAllNotificationsReadResponse = z.infer<typeof markAllNotificationsReadResponseSchema>

export const notificationTypeSettingSchema = z
  .object({
    admin_only: z.boolean().meta({ description: 'Only admins receive this type' }),
    description: z.string().meta({ description: 'What raises this type' }),
    in_app: z.boolean().meta({ description: 'Show this type under the bell' }),
    label: z.string().meta({ description: 'Human-readable name' }),
    push: z.boolean().meta({ description: 'Deliver this type as a device push' }),
    type: z.string().meta({ description: 'The notification type (see `NotificationType`)' }),
  })
  .meta({
    description: 'One notification type and the user’s switches for it',
    id: 'NotificationTypeSetting',
  })

export type NotificationTypeSetting = z.infer<typeof notificationTypeSettingSchema>

export const notificationTypesResponseSchema = baseResponseSchema
  .extend({ types: z.array(notificationTypeSettingSchema) })
  .meta({ id: 'NotificationTypesResponse' })

export type NotificationTypesResponse = z.infer<typeof notificationTypesResponseSchema>

export const setNotificationPreferenceBodySchema = z
  .object({
    in_app: z.boolean().optional().meta({ description: 'Show this type under the bell' }),
    push: z.boolean().optional().meta({ description: 'Deliver this type as a device push' }),
  })
  .refine((body) => body.in_app !== undefined || body.push !== undefined, {
    message: 'At least one of in_app or push must be provided',
    path: ['in_app'],
  })
  .meta({ id: 'SetNotificationPreferenceBody' })

export type SetNotificationPreferenceBody = z.infer<typeof setNotificationPreferenceBodySchema>

export const setNotificationPreferenceResponseSchema = baseResponseSchema
  .extend({ type_setting: notificationTypeSettingSchema.optional() })
  .meta({ id: 'SetNotificationPreferenceResponse' })

export type SetNotificationPreferenceResponse = z.infer<typeof setNotificationPreferenceResponseSchema>
