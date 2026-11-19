import { z } from 'zod'

import { baseResponseSchema } from './common.ts'
import { feedPostMessageMaxLength, timelineImageSchema } from './feed.ts'

/**
 * A challenge hosted on this instance has one comment thread, kept in the host's database. Its
 * entries are comments, the personal notes of shares and the host's result post.
 *
 * - `public` — readable by anyone who can see the challenge; only on a public challenge.
 * - `participants` — readable and writable only by the host and the challenge's members. Every
 *   entry of an unlisted challenge is `participants`.
 */
export const challengeThreadAudienceSchema = z
  .enum(['public', 'participants'])
  .meta({ description: 'Who can read a challenge thread entry', id: 'ChallengeThreadAudience' })

export type ChallengeThreadAudience = z.infer<typeof challengeThreadAudienceSchema>

export const challengeThreadEntryKindSchema = z.enum(['share', 'comment', 'result']).meta({
  description:
    "`share`: a challenge share's personal note; `comment`: a comment or a reply; `result`: the host's result post",
  id: 'ChallengeThreadEntryKind',
})

export type ChallengeThreadEntryKind = z.infer<typeof challengeThreadEntryKindSchema>

export const challengeThreadAuthorSchema = z
  .object({
    actor_uri: z.string().meta({ description: "The author's ActivityPub actor URI" }),
    avatar_url: z.string().nullable().meta({ description: "The author's avatar URL, if known" }),
    display_name: z.string().nullable().meta({ description: "The author's display name, if known" }),
    handle: z.string().nullable().meta({ description: "The author's `@user@host`, if known" }),
  })
  .meta({ id: 'ChallengeThreadAuthor' })

export type ChallengeThreadAuthor = z.infer<typeof challengeThreadAuthorSchema>

export const challengeThreadReplySchema = z
  .object({
    audience: challengeThreadAudienceSchema,
    author: challengeThreadAuthorSchema,
    content: z.string().meta({ description: 'The entry as sanitised HTML' }),
    edited_at: z.string().nullable().meta({ description: 'When the entry was last edited (ISO 8601)' }),
    hidden: z.boolean().meta({ description: 'Hidden by the host; only the host is shown hidden entries' }),
    id: z.string().uuid().meta({ description: 'Thread entry ID' }),
    images: z.array(timelineImageSchema).meta({ description: 'Images attached to the entry' }),
    in_reply_to_id: z
      .string()
      .uuid()
      .nullable()
      .meta({ description: 'The entry this one answers; null for a top-level entry' }),
    kind: challengeThreadEntryKindSchema,
    message: z.string().optional().meta({
      description: "The viewer's own markdown source, present with `own_post_id`",
    }),
    own_post_id: z.string().uuid().optional().meta({
      description:
        "The viewer's own feed post behind this entry, present only on entries the viewer wrote (edit or delete it through `PATCH`/`DELETE /feed/{postId}`)",
    }),
    published_at: z.string().meta({ description: 'When the entry was published (ISO 8601)' }),
    url: z.string().nullable().meta({ description: "The entry's own page or Note id, if any" }),
  })
  .meta({ id: 'ChallengeThreadReply' })

export type ChallengeThreadReply = z.infer<typeof challengeThreadReplySchema>

export const challengeThreadEntrySchema = challengeThreadReplySchema
  .extend({
    replies: z
      .array(challengeThreadReplySchema)
      .meta({ description: 'Replies to this entry, oldest first; empty on a reply' }),
  })
  .meta({ id: 'ChallengeThreadEntry' })

export type ChallengeThreadEntry = z.infer<typeof challengeThreadEntrySchema>

export const challengeThreadRoleSchema = z
  .enum(['host', 'member', 'visitor'])
  .meta({ description: "The viewer's role in the challenge", id: 'ChallengeThreadRole' })

export type ChallengeThreadRole = z.infer<typeof challengeThreadRoleSchema>

export const challengeThreadViewerSchema = z
  .object({
    audiences: z
      .array(challengeThreadAudienceSchema)
      .meta({ description: 'The audiences the viewer may comment with, possibly none' }),
    can_comment: z.boolean().meta({ description: 'Whether the viewer may comment at all' }),
    role: challengeThreadRoleSchema,
  })
  .meta({ id: 'ChallengeThreadViewer' })

export type ChallengeThreadViewer = z.infer<typeof challengeThreadViewerSchema>

export const challengeThreadResponseSchema = baseResponseSchema
  .extend({
    entries: z
      .array(challengeThreadEntrySchema)
      .optional()
      .meta({ description: 'Top-level entries, newest first, each with its replies' }),
    next_cursor: z.string().nullable().optional().meta({ description: 'Cursor of the next page, if any' }),
    total: z.number().int().optional().meta({ description: 'How many entries the viewer can see' }),
    viewer: challengeThreadViewerSchema.optional(),
  })
  .meta({ id: 'ChallengeThreadResponse' })

export type ChallengeThreadResponse = z.infer<typeof challengeThreadResponseSchema>

const challengeUrlSchema = z
  .string()
  .url()
  .max(500)
  .meta({ description: "The challenge's page URL, e.g. `https://aurboda.net/u/alice/abc123`" })

export const challengeThreadQuerySchema = z
  .object({
    challenge_url: challengeUrlSchema,
    cursor: z.string().optional().meta({ description: "Opaque cursor from a previous page's `next_cursor`" }),
  })
  .meta({ id: 'ChallengeThreadQuery' })

export type ChallengeThreadQuery = z.infer<typeof challengeThreadQuerySchema>

export const publicChallengeThreadQuerySchema = z
  .object({
    cursor: z.string().optional().meta({ description: "Opaque cursor from a previous page's `next_cursor`" }),
  })
  .meta({ id: 'PublicChallengeThreadQuery' })

export type PublicChallengeThreadQuery = z.infer<typeof publicChallengeThreadQuerySchema>

export const challengeCommentBodySchema = z
  .object({
    audience: challengeThreadAudienceSchema,
    challenge_url: challengeUrlSchema,
    in_reply_to_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'The thread entry to reply to; absent for a top-level comment' }),
    message: z
      .string()
      .min(1)
      .max(feedPostMessageMaxLength)
      .refine((text) => text.trim().length > 0, { message: 'Comment text cannot be blank' })
      .meta({ description: 'The comment (markdown, rendered through the shared sanitiser)' }),
  })
  .meta({
    description:
      'A comment in a challenge thread. `participants` is readable by the host and members only; a reply is never wider than the entry it answers.',
    id: 'ChallengeCommentBody',
  })

export type ChallengeCommentBody = z.infer<typeof challengeCommentBodySchema>

export const challengeThreadEntryResponseSchema = baseResponseSchema
  .extend({ entry: challengeThreadEntrySchema.optional() })
  .meta({ id: 'ChallengeThreadEntryResponse' })

export type ChallengeThreadEntryResponse = z.infer<typeof challengeThreadEntryResponseSchema>

export const challengeThreadHideBodySchema = z
  .object({ challenge_url: challengeUrlSchema })
  .meta({ description: 'The challenge whose thread entry is hidden', id: 'ChallengeThreadHideBody' })

export type ChallengeThreadHideBody = z.infer<typeof challengeThreadHideBodySchema>

export const challengeThreadHideQuerySchema = z
  .object({ challenge_url: challengeUrlSchema })
  .meta({ description: 'The challenge whose thread entry is shown again', id: 'ChallengeThreadHideQuery' })

export type ChallengeThreadHideQuery = z.infer<typeof challengeThreadHideQuerySchema>
