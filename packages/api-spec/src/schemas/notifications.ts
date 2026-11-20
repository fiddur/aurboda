import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema, queryBooleanSchema, UUID_RE } from './common.ts'

/**
 * Every kind of notification the server raises. Adding one is a registry entry
 * here plus a `raise` call where the event happens; nothing in the database
 * changes, since a stored notification's `type` is plain text.
 */
export const notificationTypes = [
  'admin_signup',
  'feed_follow_request',
  'feed_new_follower',
  'feed_follow_accepted',
  'feed_reply',
  'feed_mention',
  'feed_like',
  'feed_boost',
  'feed_post',
  'challenge_comment',
  'autoshare_pending',
  'garmin_key_expiring',
  'reminder',
] as const

export type NotificationType = (typeof notificationTypes)[number]

export const notificationTypeSchema = z.enum(notificationTypes).meta({
  description: 'A kind of notification. Each has its own in-app and push switches.',
  example: 'admin_signup',
  id: 'NotificationType',
})

export const isNotificationType = (value: string): value is NotificationType =>
  (notificationTypes as readonly string[]).includes(value)

export const notificationGroups = ['feed', 'data_sources', 'reminders', 'admin'] as const

export type NotificationGroup = (typeof notificationGroups)[number]

export const notificationGroupLabels: Record<NotificationGroup, string> = {
  admin: 'Admin',
  data_sources: 'Data sources',
  feed: 'Feed',
  reminders: 'Reminders',
}

export interface NotificationTypeInfo {
  group: NotificationGroup
  label: string
  description: string
  /** Only admins receive it, and only admins see its settings row. */
  admin_only: boolean
}

export const notificationTypeInfo: Record<NotificationType, NotificationTypeInfo> = {
  admin_signup: {
    admin_only: true,
    description: 'Someone created an account on this server',
    group: 'admin',
    label: 'New signups',
  },
  feed_follow_request: {
    admin_only: false,
    description: 'Someone asks to follow you and you approve followers by hand',
    group: 'feed',
    label: 'Follow requests',
  },
  feed_new_follower: {
    admin_only: false,
    description: 'Someone started following you',
    group: 'feed',
    label: 'New followers',
  },
  feed_follow_accepted: {
    admin_only: false,
    description: 'An account you asked to follow accepted, after a wait',
    group: 'feed',
    label: 'Accepted follow requests',
  },
  feed_reply: {
    admin_only: false,
    description: 'Someone replied to one of your posts',
    group: 'feed',
    label: 'Replies',
  },
  feed_mention: {
    admin_only: false,
    description: 'Someone mentioned you in a post',
    group: 'feed',
    label: 'Mentions',
  },
  feed_like: {
    admin_only: false,
    description: 'Someone liked one of your posts',
    group: 'feed',
    label: 'Likes',
  },
  feed_boost: {
    admin_only: false,
    description: 'Someone boosted one of your posts (a hashtag feed listing it does not count)',
    group: 'feed',
    label: 'Boosts',
  },
  feed_post: {
    admin_only: false,
    description:
      'A new post or boost from an account, or a new post in a tag, whose bell is on in your Following and Followed tags lists',
    group: 'feed',
    label: 'New posts',
  },
  challenge_comment: {
    admin_only: false,
    description: 'Someone commented in a challenge you host or take part in',
    group: 'feed',
    label: 'Challenge comments',
  },
  autoshare_pending: {
    admin_only: false,
    description:
      'An auto-share rule is about to share a new activity; the notification lets you stop that one',
    group: 'feed',
    label: 'Pending auto-shares',
  },
  garmin_key_expiring: {
    admin_only: false,
    description: 'Your Garmin Personal API key is about to expire, has expired, or was refused by Garmin',
    group: 'data_sources',
    label: 'Garmin key renewal',
  },
  reminder: {
    admin_only: false,
    description: 'A reminder you set up yourself is due',
    group: 'reminders',
    label: 'Reminders',
  },
}

export const notificationActionSchema = z
  .object({
    key: z
      .string()
      .meta({ description: 'Identifies the action in `POST /notifications/{id}/actions/{key}`' }),
    label: z.string().meta({ description: 'Button text' }),
  })
  .meta({
    description: 'A button a notification offers; the server decides what it does',
    id: 'NotificationAction',
  })

export type NotificationAction = z.infer<typeof notificationActionSchema>

export const notificationSchema = z
  .object({
    actions: z.array(notificationActionSchema).meta({
      description:
        'Buttons the notification offers; run one with `POST /notifications/{id}/actions/{key}`. Empty when there are none or one was already run.',
    }),
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
    ids: z
      .string()
      .refine(
        (ids) => ids.split(',').every((id) => UUID_RE.test(id)),
        'Must be comma-separated notification IDs',
      )
      .refine((ids) => ids.split(',').length <= 100, 'At most 100 IDs')
      .optional()
      .meta({
        description:
          'Only these notifications (comma-separated IDs, at most 100), read or not unless `unread_only` is set: a device re-reads the ones it is showing to update or withdraw them. An ID missing from the answer was deleted.',
      }),
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
    group: z.string().meta({
      description:
        'The group the type is shown under in settings (`feed`, `data_sources`, `reminders`, `admin`). Plain text, like `type`, so a client never fails to decode a group added after it was built.',
      example: 'feed',
    }),
    group_label: z.string().meta({ description: 'Human-readable name of the group', example: 'Feed' }),
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

export const PUSH_ENDPOINT_MAX_LENGTH = 2048

export const pushConfigResponseSchema = baseResponseSchema
  .extend({
    enabled: z.boolean().meta({
      description:
        'Whether this server offers browser push: false when its web address is not HTTPS (browsers refuse push there; `localhost` is allowed for development)',
    }),
    public_key: z.string().optional().meta({
      description:
        'The server’s VAPID public key (URL-safe base64), the `applicationServerKey` to subscribe with; absent when push is not enabled',
    }),
  })
  .meta({ id: 'PushConfigResponse' })

export type PushConfigResponse = z.infer<typeof pushConfigResponseSchema>

export const addPushSubscriptionBodySchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(PUSH_ENDPOINT_MAX_LENGTH)
      .meta({ description: 'The push service URL the browser was given (`PushSubscription.endpoint`)' }),
    keys: z
      .object({
        auth: z.string().min(1).max(256).meta({ description: 'The subscription’s auth secret' }),
        p256dh: z.string().min(1).max(256).meta({ description: 'The subscription’s P-256 public key' }),
      })
      .meta({ description: 'The keys the payload is encrypted to (`PushSubscription.toJSON().keys`)' }),
  })
  .meta({
    description:
      'A browser’s `PushSubscription` as `toJSON()` gives it. Other fields (such as `expirationTime`) are ignored.',
    id: 'AddPushSubscriptionBody',
  })

export type AddPushSubscriptionBody = z.infer<typeof addPushSubscriptionBodySchema>

export const pushSubscriptionSchema = z
  .object({
    browser: z.string().meta({
      description: 'A readable label derived from the browser’s user agent',
      example: 'Firefox on Android',
    }),
    created_at: iso8601DateTimeSchema.meta({ description: 'When the browser subscribed' }),
    current: z.boolean().meta({
      description: 'Whether this is the subscription whose `endpoint` the request named',
    }),
    id: z.string().uuid().meta({ description: 'Subscription ID' }),
    last_success_at: iso8601DateTimeSchema
      .nullable()
      .meta({ description: 'When a push last reached it, or null if none has yet' }),
  })
  .meta({ description: 'A browser subscribed to this user’s push notifications', id: 'PushSubscription' })

export type PushSubscription = z.infer<typeof pushSubscriptionSchema>

export const pushSubscriptionsQuerySchema = z
  .object({
    endpoint_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional()
      .meta({
        description:
          'SHA-256 (lowercase hex) of this browser’s own endpoint, so its subscription is marked `current` without the endpoint appearing in a URL',
      }),
  })
  .meta({ id: 'PushSubscriptionsQuery' })

export type PushSubscriptionsQuery = z.infer<typeof pushSubscriptionsQuerySchema>

export const pushSubscriptionsResponseSchema = baseResponseSchema
  .extend({ subscriptions: z.array(pushSubscriptionSchema) })
  .meta({ id: 'PushSubscriptionsResponse' })

export type PushSubscriptionsResponse = z.infer<typeof pushSubscriptionsResponseSchema>

export const pushSubscriptionResponseSchema = baseResponseSchema
  .extend({ subscription: pushSubscriptionSchema.optional() })
  .meta({ id: 'PushSubscriptionResponse' })

export type PushSubscriptionResponse = z.infer<typeof pushSubscriptionResponseSchema>

export const sendTestPushResponseSchema = baseResponseSchema
  .extend({
    reached: z
      .number()
      .int()
      .optional()
      .meta({ description: 'How many subscribed browsers accepted the test push' }),
    total: z.number().int().optional().meta({ description: 'How many browsers were subscribed' }),
  })
  .meta({ id: 'SendTestPushResponse' })

export type SendTestPushResponse = z.infer<typeof sendTestPushResponseSchema>

export const webPushPayloadSchema = z
  .object({
    body: z.string().nullable().meta({ description: 'The notification’s body, if it has one' }),
    id: z.string().meta({ description: 'The notification’s ID (`test` for a test push)' }),
    link: z.string().nullable().meta({ description: 'The in-app path a click opens, if any' }),
    title: z.string().meta({ description: 'The notification’s title' }),
    type: z.string().meta({ description: 'The notification type' }),
  })
  .meta({
    description: 'What a push carries to the service worker, encrypted to the browser',
    id: 'WebPushPayload',
  })

export type WebPushPayload = z.infer<typeof webPushPayloadSchema>
