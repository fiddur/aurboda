import { z } from 'zod'

import { normalizeTag } from '../hashtags.ts'
import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  createDataResponseSchema,
  dateOnlySchema,
  iso8601DateTimeSchema,
  queryBooleanSchema,
  UUID_RE,
} from './common.ts'
import { INLINE_PICTURE_HINT, noteAttachmentSchema } from './note-attachments.ts'
import { ianaTimezoneSchema } from './timezone.ts'

/**
 * Valid entity types for notes and soft-delete references.
 *
 * Besides the real entities, three shapes are special:
 *  - `note` — the note is a reply; `entity_id` is the id of the comment it replies to.
 *  - `time` — the note is anchored to a moment rather than an entity; it has no
 *    `entity_id` and carries its own `start_time` (required) and `end_time` (optional).
 *  - `day` — the note is pinned to a calendar date (`date`), with no time of day and no `entity_id`.
 */
export const entityTypes = [
  'activity',
  'productivity',
  'metric',
  'report',
  'meal',
  'note',
  'time',
  'day',
  'person',
] as const

export const entityTypeSchema = z.enum(entityTypes).meta({
  description:
    'Entity type for polymorphic references. `person` is a note about a person (no times; read through the person). `note` marks a reply — `entity_id` is the id of the comment it replies to. `time` marks a comment anchored to a moment — no `entity_id`, and `start_time`/`end_time` are supplied by the user. `day` marks an entry pinned to a calendar date — no `entity_id`, no times, and a required `date`.',
  example: 'activity',
  id: 'EntityType',
})

export type EntityType = z.infer<typeof entityTypeSchema>

/** Entity types whose `entity_id` is a UUID. A metric's is a composite key and a `time` note has none. */
export const uuidEntityTypes: readonly EntityType[] = [
  'activity',
  'productivity',
  'report',
  'meal',
  'note',
  'person',
]

export const isValidEntityId = (entityType: EntityType, entityId: string): boolean =>
  !uuidEntityTypes.includes(entityType) || UUID_RE.test(entityId)

/** The free-standing shapes: a journal entry is one of these, and only these may have empty text. */
export const freeStandingNoteTypes: readonly EntityType[] = ['time', 'day']

export const isFreeStandingNoteType = (entityType: EntityType): boolean =>
  freeStandingNoteTypes.includes(entityType)

/** A soft-deleted comment is removed for good this many days after its deletion. */
export const DELETED_NOTE_RETENTION_DAYS = 30

/** Saves closer together than this to the newest revision keep no revision of their own. */
export const NOTE_REVISION_MIN_INTERVAL_MINUTES = 10

/** The newest revisions kept per comment. */
export const NOTE_REVISION_LIMIT = 50

export const NOTE_TITLE_MAX_LENGTH = 200

export const NOTE_TAGS_MAX = 20

export const NOTE_REPLY_RELATED_ERROR = 'A reply cannot be related to anything'

export const NOTES_SEARCH_DEFAULT_LIMIT = 50

export const NOTES_SEARCH_MAX_LIMIT = 200

/** The tags as stored (lowercase, no `#`, deduplicated), or null when any of them is not a valid tag. */
export const normalizeNoteTags = (tags: readonly string[]): string[] | null => {
  const out: string[] = []
  for (const value of tags) {
    const tag = normalizeTag(value)
    if (tag === null) return null
    if (!out.includes(tag)) out.push(tag)
  }
  return out
}

/** A note's title as stored: trimmed, with an empty one meaning none. */
export const normalizeNoteTitle = (title: string | null | undefined): string | null | undefined =>
  title == null ? title : title.trim() || null

/** An end before the start would draw as a negative-width block. */
export const endPrecedesStart = (
  startTime: string | undefined,
  endTime: string | null | undefined,
): boolean =>
  startTime !== undefined && endTime != null && new Date(endTime).getTime() < new Date(startTime).getTime()

/**
 * A reply inside a comment thread. Threads are exactly one level deep, so a
 * reply never carries replies of its own.
 */
const noteDateSchema = z.iso.date().meta({
  description: 'The calendar date a `day` entry is pinned to (YYYY-MM-DD). Absent on every other shape.',
})

const noteTitleResponseSchema = z.string().meta({ description: 'Title of a thread root, if it has one' })

const noteTagsResponseSchema = z.array(z.string()).meta({
  description:
    'Tags: the ones set explicitly plus the #hashtags written in the content, lowercase without `#`, deduplicated and sorted',
})

const noteDeletedAtSchema = z.iso.datetime().meta({
  description: 'When the comment was deleted. Only in the list of deleted comments and the restore answer.',
})

const notePurgeAtSchema = z.iso.datetime().meta({
  description: `When a deleted comment is removed for good (${DELETED_NOTE_RETENTION_DAYS} days after its deletion). Only in the list of deleted comments.`,
})

export const noteReplySchema = z
  .object({
    content: z.string().meta({ description: 'Reply content (markdown)' }),
    created_at: iso8601DateTimeSchema.optional(),
    date: noteDateSchema.optional(),
    deleted_at: noteDeletedAtSchema.optional(),
    end_time: iso8601DateTimeSchema.optional().meta({
      description: 'End time inherited from the thread root (if any)',
    }),
    id: z.string().uuid().optional().meta({ description: 'Reply (note) ID' }),
    source: z.string().optional().meta({
      description:
        'Data source that authored this reply. Null/absent for user-typed replies; set for synced ones.',
    }),
    start_time: iso8601DateTimeSchema.optional().meta({
      description: 'Start time inherited from the thread root',
    }),
    tags: noteTagsResponseSchema.optional(),
    updated_at: iso8601DateTimeSchema.optional(),
  })
  .meta({ description: 'A reply in a comment thread (threads are one level deep)', id: 'NoteReply' })

export type NoteReply = z.infer<typeof noteReplySchema>

export const noteRelatedEntityTypes = ['person', 'activity', 'meal', 'report', 'check_in'] as const

export const noteRelatedEntityTypeSchema = z.enum(noteRelatedEntityTypes).meta({
  description:
    'What a journal entry can be related to: a person, an activity, a meal, a report or a check-in',
  id: 'NoteRelatedEntityType',
})

export type NoteRelatedEntityType = z.infer<typeof noteRelatedEntityTypeSchema>

export const NOTE_RELATED_MAX = 30

export const JOURNAL_ENTRY_REFS_LIMIT = 50

export const JOURNAL_ENTRY_EXCERPT_MAX = 200

export const noteRelatedInputSchema = z
  .object({
    entity_id: z
      .string()
      .uuid()
      .meta({ description: 'ID of the person, activity, meal, report or check-in' }),
    entity_type: noteRelatedEntityTypeSchema,
  })
  .meta({
    description: 'A person, an activity, a meal, a report or a check-in a note is related to',
    id: 'NoteRelatedInput',
  })

export type NoteRelatedInput = z.infer<typeof noteRelatedInputSchema>

export const noteRelatedSchema = z
  .object({
    entity_id: z
      .string()
      .uuid()
      .meta({ description: 'ID of the person, activity, meal, report or check-in' }),
    entity_type: noteRelatedEntityTypeSchema,
    label: z.string().meta({
      description:
        'Display label, made when read: the person\'s name; for an activity its title (else its type\'s name) and its local date (a sleep\'s, the day it ended), e.g. "Evening walk, 2026-11-20"; for a meal its type and local time, e.g. "Lunch 12:30"; for a report its type and local date, e.g. "Blood Panel, 2026-11-20"; for a check-in its form\'s name and local time, e.g. "Morning 07:45"',
    }),
    activity_type: z
      .string()
      .optional()
      .meta({ description: "An activity's type, for its icon; absent for anything else" }),
    form_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: "A check-in's form, whose page lists it; absent for anything else" }),
  })
  .meta({
    description:
      'A person, an activity, a meal, a report or a check-in the note is related to, without being a comment on it',
    id: 'NoteRelated',
  })

export type NoteRelated = z.infer<typeof noteRelatedSchema>

const noteRelatedInputListSchema = z
  .array(noteRelatedInputSchema)
  .max(NOTE_RELATED_MAX)
  .meta({
    description: `The people, activities, meals, reports and check-ins this note is related to, without being a comment on them (at most ${NOTE_RELATED_MAX}). The full list: it replaces the note's links when present; an empty list removes them all. Duplicates are collapsed. Not on a reply.`,
  })

export const journalEntryRefSchema = z
  .object({
    date: noteDateSchema.optional(),
    entity_type: entityTypeSchema,
    excerpt: z.string().meta({
      description: `The first non-empty line of the text, at most ${JOURNAL_ENTRY_EXCERPT_MAX} characters`,
    }),
    id: z.string().uuid().meta({ description: 'Note ID' }),
    start_time: iso8601DateTimeSchema
      .optional()
      .meta({ description: 'When the note is anchored, if at a time' }),
    title: noteTitleResponseSchema.optional(),
  })
  .meta({
    description:
      'A journal entry or comment related to a person, an activity, a meal, a report or a check-in',
    id: 'JournalEntryRef',
  })

export type JournalEntryRef = z.infer<typeof journalEntryRefSchema>

const journalEntriesDescription = `Journal entries and comments related to this, newest first (at most ${JOURNAL_ENTRY_REFS_LIMIT}). Private: never in a share.`

export const journalEntryRefsSchema = z.array(journalEntryRefSchema).meta({
  description: journalEntriesDescription,
})

export const noteSchema = z
  .object({
    attachments: z.array(noteAttachmentSchema).optional().meta({
      description:
        'The pictures and recordings on a journal entry (a "time" or "day" thread root), in page order',
    }),
    content: z.string().meta({ description: 'Note content (markdown)' }),
    created_at: iso8601DateTimeSchema.optional(),
    date: noteDateSchema.optional(),
    deleted_at: noteDeletedAtSchema.optional(),
    end_time: iso8601DateTimeSchema.optional().meta({
      description: 'End time inherited from the parent entity (if any), or set by the user for a time note',
    }),
    entity_id: z.string().nullable().optional().meta({
      description:
        'ID of the referenced entity (UUID for most types, composite key for metrics, root note id for a reply). Null for a `time` note.',
    }),
    entity_type: entityTypeSchema,
    id: z.string().uuid().optional().meta({ description: 'Note ID' }),
    purge_at: notePurgeAtSchema.optional(),
    related: z.array(noteRelatedSchema).optional().meta({
      description:
        'The people, activities, meals, reports and check-ins this note is related to (a thread root only; a deleted target is left out until it is restored)',
    }),
    replies: z.array(noteReplySchema).optional().meta({
      description: "Replies in this comment's thread, oldest first",
    }),
    source: z.string().optional().meta({
      description:
        'Data source that authored this note. Null/absent for user-typed notes; set for synced ones (e.g. "health_connect", "oura"), which are not editable through this API.',
    }),
    start_time: iso8601DateTimeSchema.optional().meta({
      description: 'Start time inherited from the parent entity, or set by the user for a time note',
    }),
    tags: noteTagsResponseSchema.optional(),
    title: noteTitleResponseSchema.optional(),
    updated_at: iso8601DateTimeSchema.optional(),
  })
  .meta({ id: 'Note' })

export type Note = z.infer<typeof noteSchema>

/**
 * Embedded comment schema (without entity_type/entity_id since those are implicit).
 */
export const commentSchema = z
  .object({
    content: z.string().meta({ description: 'Comment content (markdown)' }),
    created_at: iso8601DateTimeSchema.optional(),
    end_time: iso8601DateTimeSchema.optional().meta({
      description: 'End time inherited from the parent entity (if any)',
    }),
    id: z.string().uuid().optional().meta({ description: 'Comment/note ID' }),
    replies: z.array(noteReplySchema).optional().meta({
      description: "Replies in this comment's thread, oldest first",
    }),
    source: z.string().optional().meta({
      description:
        'Data source that authored this comment. Null/absent for user-typed comments; set for synced comments (e.g. "health_connect", "oura").',
    }),
    start_time: iso8601DateTimeSchema.optional().meta({
      description: 'Start time inherited from the parent entity',
    }),
    tags: noteTagsResponseSchema.optional(),
    title: noteTitleResponseSchema.optional(),
    updated_at: iso8601DateTimeSchema.optional(),
  })
  .meta({ description: 'A comment attached to an entity', id: 'Comment' })

export type Comment = z.infer<typeof commentSchema>

interface CheckContext {
  issues: z.core.$ZodRawIssue[]
}

const pushIssue = (ctx: CheckContext, path: string, input: unknown, message: string): void => {
  ctx.issues.push({ code: 'custom', input, message, path: [path] })
}

const noteTitleInputSchema = z
  .string()
  .max(NOTE_TITLE_MAX_LENGTH)
  .meta({
    description: `Title (at most ${NOTE_TITLE_MAX_LENGTH} characters; trimmed, empty means none). Only on a thread root, never on a reply.`,
  })

const noteTagInputSchema = z.string()

const noteTagsInputSchema = z
  .array(noteTagInputSchema)
  .max(NOTE_TAGS_MAX)
  .meta({
    description: `Tags set explicitly (at most ${NOTE_TAGS_MAX}), e.g. ["travel", "family"]: stored lowercase without "#". #hashtags written in the content are tags too, without being listed here.`,
  })

const checkTags = (ctx: CheckContext, tags: readonly string[] | undefined): void => {
  if (tags === undefined) return
  const invalid = tags.find((tag) => normalizeTag(tag) === null)
  if (invalid !== undefined) {
    pushIssue(ctx, 'tags', invalid, `Not a valid tag: ${invalid} (letters, digits and _, not only digits)`)
  }
}

interface NoteShapeInput {
  entity_type: EntityType
  entity_id?: string | null
  start_time?: string
  end_time?: string
  date?: string
}

const checkDayShape = (ctx: CheckContext, body: NoteShapeInput): void => {
  if (body.entity_id !== undefined && body.entity_id !== null) {
    pushIssue(ctx, 'entity_id', body.entity_id, "entity_id must be omitted when entity_type is 'day'")
  }
  if (body.date === undefined) pushIssue(ctx, 'date', body.date, "date is required when entity_type is 'day'")
  if (body.start_time !== undefined) {
    pushIssue(ctx, 'start_time', body.start_time, "A 'day' entry has no start_time")
  }
  if (body.end_time !== undefined) pushIssue(ctx, 'end_time', body.end_time, "A 'day' entry has no end_time")
}

const checkTimeShape = (ctx: CheckContext, body: NoteShapeInput): void => {
  if (body.entity_id !== undefined && body.entity_id !== null) {
    pushIssue(ctx, 'entity_id', body.entity_id, "entity_id must be omitted when entity_type is 'time'")
  }
  if (body.start_time === undefined) {
    pushIssue(ctx, 'start_time', body.start_time, "start_time is required when entity_type is 'time'")
  }
  if (endPrecedesStart(body.start_time, body.end_time)) {
    pushIssue(ctx, 'end_time', body.end_time, 'end_time must not precede start_time')
  }
}

const checkAnchoredShape = (ctx: CheckContext, body: NoteShapeInput): void => {
  if (body.entity_id === undefined || body.entity_id === null) {
    pushIssue(ctx, 'entity_id', body.entity_id, "entity_id is required unless entity_type is 'time' or 'day'")
  } else if (!isValidEntityId(body.entity_type, body.entity_id)) {
    pushIssue(
      ctx,
      'entity_id',
      body.entity_id,
      `entity_id must be a UUID when entity_type is '${body.entity_type}'`,
    )
  }
  if (body.start_time !== undefined) {
    pushIssue(ctx, 'start_time', body.start_time, "start_time can only be set when entity_type is 'time'")
  }
  if (body.end_time !== undefined) {
    pushIssue(ctx, 'end_time', body.end_time, "end_time can only be set when entity_type is 'time'")
  }
}

/**
 * Add note request body.
 *
 * Four shapes are accepted:
 *  - a comment on an entity — `entity_type` + `entity_id`, no times;
 *  - a reply — `entity_type: 'note'` + the comment's id, no times;
 *  - a comment about a moment — `entity_type: 'time'`, no `entity_id`,
 *    `start_time` required and `end_time` optional;
 *  - an entry for a day — `entity_type: 'day'`, no `entity_id`, no times, `date` required.
 *
 * Only `time` and `day` notes may have empty content.
 */
export const addNoteBodySchema = z
  .object({
    content: z.string().meta({
      description: `Note content (markdown). May be empty only for \`entity_type\` "time" or "day"; #hashtags in it become tags. ${INLINE_PICTURE_HINT}`,
    }),
    date: dateOnlySchema.optional().meta({
      description: "Only for `entity_type: 'day'` (required there) — the calendar date, YYYY-MM-DD",
    }),
    end_time: iso8601DateTimeSchema.optional().meta({
      description: "Only for `entity_type: 'time'` — when the comment is about (end of the span)",
    }),
    entity_id: z.string().min(1).nullable().optional().meta({
      description:
        'ID of the referenced entity (UUID for most types, composite key for metrics, the comment id for a reply). Omit for `entity_type` "time" and "day".',
    }),
    entity_type: entityTypeSchema,
    related: noteRelatedInputListSchema.optional(),
    start_time: iso8601DateTimeSchema.optional().meta({
      description: "Only for `entity_type: 'time'` — when the comment is about (required)",
    }),
    tags: noteTagsInputSchema.optional(),
    title: noteTitleInputSchema.nullable().optional(),
  })
  .check((ctx) => {
    const body = ctx.value
    checkTags(ctx, body.tags)
    if (body.content.length === 0 && !isFreeStandingNoteType(body.entity_type)) {
      pushIssue(ctx, 'content', body.content, 'content must not be empty')
    }
    if (body.entity_type === 'note' && normalizeNoteTitle(body.title) != null) {
      pushIssue(ctx, 'title', body.title, 'A reply cannot have a title')
    }
    if (body.entity_type === 'note' && body.related !== undefined) {
      pushIssue(ctx, 'related', body.related, NOTE_REPLY_RELATED_ERROR)
    }
    if (body.entity_type !== 'day' && body.date !== undefined) {
      pushIssue(ctx, 'date', body.date, "date can only be set when entity_type is 'day'")
    }
    if (body.entity_type === 'day') checkDayShape(ctx, body)
    else if (body.entity_type === 'time') checkTimeShape(ctx, body)
    else checkAnchoredShape(ctx, body)
  })
  .meta({ id: 'AddNoteBody' })

export type AddNoteBody = z.infer<typeof addNoteBodySchema>

/**
 * Update note request body. At least one field besides `expected_updated_at` must be present.
 * Times and dates can only be changed on a free-standing note: `date` makes a `time` note a `day`
 * note, `start_time` makes a `day` note a `time` note.
 */
export const updateNoteBodySchema = z
  .object({
    content: z
      .string()
      .optional()
      .meta({
        description: `Updated note content (markdown). May be empty only on a comment with \`entity_type\` "time" or "day". ${INLINE_PICTURE_HINT}`,
      }),
    date: dateOnlySchema.optional().meta({
      description:
        "New calendar date (YYYY-MM-DD). Only for a comment with `entity_type` 'time' or 'day': on a 'time' comment it makes it a 'day' entry and drops its times. Not together with start_time/end_time.",
    }),
    end_time: iso8601DateTimeSchema.nullable().optional().meta({
      description:
        "New end time, or null to clear it and make the comment a point in time. Only for a comment with `entity_type: 'time'` (or a 'day' entry given a start_time).",
    }),
    expected_updated_at: iso8601DateTimeSchema.optional().meta({
      description:
        'The `updated_at` the change was based on. When the comment has changed since, nothing is written and the answer is a 409 carrying the current comment.',
    }),
    related: noteRelatedInputListSchema.optional(),
    start_time: iso8601DateTimeSchema.optional().meta({
      description:
        "New start time. Only for a comment with `entity_type` 'time' or 'day': on a 'day' entry it makes it a 'time' comment and drops its date.",
    }),
    tags: noteTagsInputSchema.optional().meta({
      description: `Replaces the explicitly set tags (at most ${NOTE_TAGS_MAX}). #hashtags in the content stay tags whatever this says.`,
    }),
    title: noteTitleInputSchema
      .nullable()
      .optional()
      .meta({
        description: `New title (at most ${NOTE_TITLE_MAX_LENGTH} characters), or null to clear it. Not on a reply.`,
      }),
  })
  .check((ctx) => {
    const body = ctx.value
    checkTags(ctx, body.tags)
    if (
      body.content === undefined &&
      body.start_time === undefined &&
      body.end_time === undefined &&
      body.date === undefined &&
      body.title === undefined &&
      body.tags === undefined &&
      body.related === undefined
    ) {
      pushIssue(
        ctx,
        'content',
        body,
        'At least one of content, title, tags, related, date, start_time or end_time must be provided',
      )
    }
    if (body.date !== undefined && (body.start_time !== undefined || body.end_time !== undefined)) {
      pushIssue(ctx, 'date', body.date, 'date cannot be set together with start_time or end_time')
    }
    if (endPrecedesStart(body.start_time, body.end_time)) {
      pushIssue(ctx, 'end_time', body.end_time, 'end_time must not precede start_time')
    }
  })
  .meta({ id: 'UpdateNoteBody' })

export type UpdateNoteBody = z.infer<typeof updateNoteBodySchema>

export const notesQuerySchema = z
  .object({
    entity_id: z
      .string()
      .min(1)
      .meta({ description: 'ID of the referenced entity (UUID for most types, composite key for metrics)' }),
    entity_type: entityTypeSchema,
  })
  .meta({ id: 'NotesQuery' })

export type NotesQuery = z.infer<typeof notesQuerySchema>

/**
 * Notes query schema (by time range). Returns thread roots anchored in the
 * window, each with its replies nested, and the `day` entries for the window's local dates.
 */
const needsTextSchema = queryBooleanSchema.optional().meta({
  description:
    'true keeps only the entries still to be written up: at least one picture and no text (blank or whitespace)',
})

export const notesQueryRangeSchema = z
  .object({
    from: iso8601DateTimeSchema.meta({ description: 'Start of the window (inclusive)' }),
    needs_text: needsTextSchema,
    to: iso8601DateTimeSchema.meta({
      description:
        'End of the window: inclusive for comments anchored at a time, exclusive for the dates of `day` entries (a window ending at a local midnight does not include the day it opens)',
    }),
    tz: ianaTimezoneSchema.optional().meta({
      description:
        "IANA timezone the window's local dates are read in, to pick the `day` entries it covers (default: the user's timezone)",
    }),
  })
  .meta({ id: 'NotesRangeQuery' })

export type NotesRangeQuery = z.infer<typeof notesQueryRangeSchema>

export const noteParamsSchema = z
  .object({
    id: z.string().uuid().meta({ description: 'Note ID' }),
  })
  .meta({ id: 'NoteParams' })

export type NoteParams = z.infer<typeof noteParamsSchema>

export const notesResponseSchema = createDataArrayResponseSchema(noteSchema).meta({
  id: 'NotesResponse',
})

export type NotesResponse = z.infer<typeof notesResponseSchema>

export const noteResponseSchema = createDataResponseSchema(noteSchema).meta({
  id: 'NoteResponse',
})

export type NoteResponse = z.infer<typeof noteResponseSchema>

export const deleteNoteResponseSchema = baseResponseSchema
  .extend({
    purged: z
      .boolean()
      .optional()
      .describe(
        'true when the comment was removed for good (asked to purge, or it held nothing to restore), so it cannot be restored',
      ),
  })
  .meta({ id: 'DeleteNoteResponse' })

export type DeleteNoteResponse = z.infer<typeof deleteNoteResponseSchema>

/** Notes about a person are read through the person, so a deleted person's stay out of sight. */
export const notesSearchRootTypes = entityTypes.filter((type) => type !== 'note' && type !== 'person')

export const NOTES_SEARCH_RELATED_PAIR_ERROR = 'related_type and related_id go together'

export const NOTES_SEARCH_TAGS_ERROR = 'Not a valid tag list (letters, digits and _, comma-separated)'

export const notesSearchEntityTypeError = (type: string): string =>
  `Not a comment root type: ${type} (one of ${notesSearchRootTypes.join(', ')})`

/** The first type in the `entity_types` search parameter that is not a comment root type. */
export const unknownNotesSearchEntityType = (raw: string | undefined): string | undefined =>
  splitList(raw).find((type) => !(notesSearchRootTypes as readonly string[]).includes(type))

export const NOTES_SEARCH_DEFAULT_ENTITY_TYPES: readonly EntityType[] = freeStandingNoteTypes

const splitList = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

/** The `tags` search parameter as stored tags; null when one of them is not a valid tag. */
export const parseNotesSearchTags = (raw: string | undefined): string[] | null =>
  normalizeNoteTags(splitList(raw))

/** The `entity_types` search parameter, defaulting to the free-standing entries. */
export const parseNotesSearchEntityTypes = (raw: string | undefined): EntityType[] => {
  const types = splitList(raw) as EntityType[]
  return types.length > 0 ? [...new Set(types)] : [...NOTES_SEARCH_DEFAULT_ENTITY_TYPES]
}

const notesEntityTypesQuerySchema = z.string().optional().meta({
  description:
    'Comma-separated root types to include (default "time,day", the free-standing entries). Add "activity", "meal", "report", "productivity" or "metric" to include comments on those; comments with no time (metric comments) are never listed. "note" (replies) is refused: a reply is found through its root.',
  example: 'time,day,activity',
})

const checkEntityTypes = (ctx: CheckContext, raw: string | undefined): void => {
  for (const type of splitList(raw)) {
    if (!(notesSearchRootTypes as readonly string[]).includes(type)) {
      pushIssue(ctx, 'entity_types', type, notesSearchEntityTypeError(type))
    }
  }
}

/**
 * Search and list comments, newest first. With no filter it lists the free-standing entries
 * (`time` and `day` notes), which is what the journal reads.
 */
export const notesSearchQuerySchema = z
  .object({
    cursor: z.string().optional().meta({ description: "Opaque cursor from a previous page's `next_cursor`" }),
    entity_types: notesEntityTypesQuerySchema,
    from: dateOnlySchema.optional().meta({
      description:
        "Earliest local date (YYYY-MM-DD, inclusive): a `day` entry's date, else its start_time's date in tz",
    }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(NOTES_SEARCH_MAX_LIMIT)
      .optional()
      .meta({
        description: `Max entries to return (1–${NOTES_SEARCH_MAX_LIMIT}, default ${NOTES_SEARCH_DEFAULT_LIMIT})`,
      }),
    needs_text: needsTextSchema,
    on_this_day: dateOnlySchema.optional().meta({
      description:
        'A date (YYYY-MM-DD): only entries whose local date has the same month and day in an earlier year. On 28 February of a non-leap year, 29 February entries count too.',
    }),
    q: z.string().max(500).optional().meta({
      description:
        'Full-text search over title and content (words, "quoted phrases", -excluded, or); the last word also matches as a prefix. A match in a reply returns its thread root.',
    }),
    related_id: z.string().uuid().optional().meta({
      description:
        'With related_type: only entries related to this person, activity, meal, report or check-in (by its own id)',
    }),
    related_type: noteRelatedEntityTypeSchema.optional().meta({
      description: 'With related_id: whether it names a person, an activity, a meal, a report or a check-in',
    }),
    tags: z.string().optional().meta({
      description: 'Comma-separated tags: only entries carrying all of them (set explicitly or as #hashtags)',
      example: 'travel,family',
    }),
    to: dateOnlySchema.optional().meta({ description: 'Latest local date (YYYY-MM-DD, inclusive)' }),
    tz: ianaTimezoneSchema.optional().meta({
      description: "IANA timezone the local dates are read in (default: the user's timezone)",
    }),
  })
  .check((ctx) => {
    const query = ctx.value
    if (parseNotesSearchTags(query.tags) === null) {
      pushIssue(ctx, 'tags', query.tags, NOTES_SEARCH_TAGS_ERROR)
    }
    checkEntityTypes(ctx, query.entity_types)
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      pushIssue(ctx, 'to', query.to, 'to must not precede from')
    }
    if ((query.related_type === undefined) !== (query.related_id === undefined)) {
      pushIssue(ctx, 'related_id', query.related_id, NOTES_SEARCH_RELATED_PAIR_ERROR)
    }
  })
  .meta({ id: 'NotesSearchQuery' })

export type NotesSearchQuery = z.infer<typeof notesSearchQuerySchema>

export const notesSearchResponseSchema = baseResponseSchema
  .extend({
    data: z.array(noteSchema).optional(),
    next_cursor: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Cursor of the next page, or null when this is the last' }),
    total: z.number().int().min(0).optional().meta({
      description: 'How many entries match the query across every page; on the first page (no cursor) only',
    }),
  })
  .meta({ id: 'NotesSearchResponse' })

export type NotesSearchResponse = z.infer<typeof notesSearchResponseSchema>

export const deleteNoteQuerySchema = z
  .object({
    purge: queryBooleanSchema.optional().meta({
      description: `true removes the comment (and its replies) for good at once, deleted or not. Without it a delete can be undone for ${DELETED_NOTE_RETENTION_DAYS} days.`,
    }),
  })
  .meta({ id: 'DeleteNoteQuery' })

export type DeleteNoteQuery = z.infer<typeof deleteNoteQuerySchema>

export const noteConflictResponseSchema = z
  .object({
    data: noteSchema,
    error: z.string(),
    success: z.boolean().meta({ description: 'Always false' }),
  })
  .meta({
    description:
      'The comment was changed after `expected_updated_at`: nothing was written; `data` is the comment as it now is',
    id: 'NoteConflictResponse',
  })

export type NoteConflictResponse = z.infer<typeof noteConflictResponseSchema>

export const noteRevisionSchema = z
  .object({
    content: z.string().meta({ description: 'The text as it stood before the change' }),
    id: z.string().uuid(),
    saved_at: iso8601DateTimeSchema.meta({ description: 'When the text was replaced' }),
    title: z.string().optional().meta({ description: 'The title as it stood, if it had one' }),
  })
  .meta({ description: "An earlier version of a comment's text", id: 'NoteRevision' })

export type NoteRevision = z.infer<typeof noteRevisionSchema>

export const noteRevisionsResponseSchema = createDataArrayResponseSchema(noteRevisionSchema).meta({
  id: 'NoteRevisionsResponse',
})

export type NoteRevisionsResponse = z.infer<typeof noteRevisionsResponseSchema>

export const noteNeighborSchema = z
  .object({
    date: noteDateSchema.optional(),
    entity_type: entityTypeSchema,
    excerpt: z.string().meta({
      description: `The first non-empty line of the text, at most ${JOURNAL_ENTRY_EXCERPT_MAX} characters (may be empty)`,
    }),
    id: z.string().uuid().meta({ description: 'Note ID' }),
    start_time: iso8601DateTimeSchema.optional().meta({ description: 'When a `time` entry is anchored' }),
    title: noteTitleResponseSchema.optional(),
  })
  .meta({ description: 'A Journal entry next to another one', id: 'NoteNeighbor' })

export type NoteNeighbor = z.infer<typeof noteNeighborSchema>

export const noteNeighborsQuerySchema = z
  .object({
    tz: ianaTimezoneSchema.optional().meta({
      description: "IANA timezone a `day` entry's date is read in (default: the user's timezone)",
    }),
  })
  .meta({ id: 'NoteNeighborsQuery' })

export type NoteNeighborsQuery = z.infer<typeof noteNeighborsQuerySchema>

export const noteNeighborsSchema = z
  .object({
    next: noteNeighborSchema.optional().meta({ description: 'The newer entry, if any' }),
    previous: noteNeighborSchema.optional().meta({ description: 'The older entry, if any' }),
  })
  .meta({
    description: "The Journal entries just before and after one entry, in the Journal's order",
    id: 'NoteNeighbors',
  })

export type NoteNeighbors = z.infer<typeof noteNeighborsSchema>

export const noteNeighborsResponseSchema = createDataResponseSchema(noteNeighborsSchema).meta({
  id: 'NoteNeighborsResponse',
})

export type NoteNeighborsResponse = z.infer<typeof noteNeighborsResponseSchema>

export const noteTagSummarySchema = z
  .object({
    count: z
      .number()
      .int()
      .min(1)
      .meta({ description: 'How many live notes carry the tag (each note once)' }),
    last_used: iso8601DateTimeSchema.meta({
      description:
        "The newest carrying note's anchor: its start time, or a `day` entry's date at its start in tz",
    }),
    tag: z.string().meta({ description: 'The tag, lowercase without `#`' }),
  })
  .meta({ description: 'A tag used on journal entries or comments', id: 'NoteTagSummary' })

export type NoteTagSummary = z.infer<typeof noteTagSummarySchema>

export const noteTagsListQuerySchema = z
  .object({
    entity_types: notesEntityTypesQuerySchema,
    tz: ianaTimezoneSchema.optional().meta({
      description: "IANA timezone a `day` entry's date is read in (default: the user's timezone)",
    }),
  })
  .check((ctx) => {
    checkEntityTypes(ctx, ctx.value.entity_types)
  })
  .meta({ id: 'NoteTagsListQuery' })

export type NoteTagsListQuery = z.infer<typeof noteTagsListQuerySchema>

export const noteTagsListResponseSchema = createDataResponseSchema(z.array(noteTagSummarySchema)).meta({
  id: 'NoteTagsListResponse',
})

export type NoteTagsListResponse = z.infer<typeof noteTagsListResponseSchema>

export const NOTE_TAGS_MERGE_INTO_ERROR = 'into must not be one of from'

export const mergeNoteTagsBodySchema = z
  .object({
    dry_run: z.boolean().default(false).meta({
      description: 'true answers how many notes the merge would change and writes nothing',
    }),
    from: z
      .array(noteTagInputSchema)
      .min(1)
      .max(NOTE_TAGS_MAX)
      .meta({ description: `The tags to merge away (1–${NOTE_TAGS_MAX}), with or without "#"` }),
    into: noteTagInputSchema.meta({ description: 'The tag they become, with or without "#"' }),
  })
  .check((ctx) => {
    const body = ctx.value
    const invalid = [...body.from, body.into].find((tag) => normalizeTag(tag) === null)
    if (invalid !== undefined) {
      pushIssue(ctx, 'from', invalid, `Not a valid tag: ${invalid} (letters, digits and _, not only digits)`)
      return
    }
    const into = normalizeTag(body.into)
    if (body.from.some((tag) => normalizeTag(tag) === into)) {
      pushIssue(ctx, 'into', body.into, NOTE_TAGS_MERGE_INTO_ERROR)
    }
  })
  .meta({ id: 'MergeNoteTagsBody' })

export type MergeNoteTagsBody = z.infer<typeof mergeNoteTagsBodySchema>

export const mergeNoteTagsResultSchema = z
  .object({
    changed: z
      .number()
      .int()
      .min(0)
      .meta({ description: 'How many notes were changed, or with dry_run would be' }),
    skipped: z.number().int().min(0).meta({
      description:
        'How many notes were not changed because they were edited while the merge ran; merging again picks them up. 0 with dry_run',
    }),
  })
  .meta({ id: 'MergeNoteTagsResult' })

export type MergeNoteTagsResult = z.infer<typeof mergeNoteTagsResultSchema>

export const mergeNoteTagsResponseSchema = createDataResponseSchema(mergeNoteTagsResultSchema).meta({
  id: 'MergeNoteTagsResponse',
})

export type MergeNoteTagsResponse = z.infer<typeof mergeNoteTagsResponseSchema>

export const noteLinkSuggestionReasonSchema = z.enum(['name_in_text', 'night_sleep', 'same_day']).meta({
  description:
    "Why it is suggested: `name_in_text` — the person's name (or, when no one else shares it, their first name) is written in the entry's title or text; `night_sleep` — the sleep that ended on the morning of an entry written before noon; `same_day` — an activity that started on the entry's day",
  id: 'NoteLinkSuggestionReason',
})

export type NoteLinkSuggestionReason = z.infer<typeof noteLinkSuggestionReasonSchema>

export const NOTE_LINK_SUGGESTIONS_SAME_DAY_MAX = 12

export const noteLinkSuggestionSchema = noteRelatedSchema
  .extend({ reason: noteLinkSuggestionReasonSchema })
  .meta({
    description:
      'A person or an activity a journal entry could be related to and is not yet. Nothing is linked until the entry is saved with it in `related`.',
    id: 'NoteLinkSuggestion',
  })

export type NoteLinkSuggestion = z.infer<typeof noteLinkSuggestionSchema>

export const noteLinkSuggestionsResponseSchema = createDataArrayResponseSchema(noteLinkSuggestionSchema).meta(
  {
    description: `The links suggested for one journal entry: the people named in it, then the night's sleep, then the activities of its day (at most ${NOTE_LINK_SUGGESTIONS_SAME_DAY_MAX}). Archived people, what it is already related to and what was dismissed for it are left out.`,
    id: 'NoteLinkSuggestionsResponse',
  },
)

export type NoteLinkSuggestionsResponse = z.infer<typeof noteLinkSuggestionsResponseSchema>

export const dismissNoteLinkSuggestionBodySchema = z
  .object({
    entity_id: z.string().uuid().meta({ description: 'ID of the suggested person or activity' }),
    entity_type: noteRelatedEntityTypeSchema,
  })
  .meta({
    description: 'A suggestion not to offer again for this entry',
    id: 'DismissNoteLinkSuggestionBody',
  })

export type DismissNoteLinkSuggestionBody = z.infer<typeof dismissNoteLinkSuggestionBodySchema>

export const NOTE_LINK_SUGGESTIONS_PAGE_DEFAULT_LIMIT = 20

export const NOTE_LINK_SUGGESTIONS_PAGE_MAX_LIMIT = 50

export const noteLinkSuggestionsPageQuerySchema = z
  .object({
    cursor: z.string().optional().meta({ description: "Opaque cursor from a previous page's `next_cursor`" }),
    from: dateOnlySchema.optional().meta({
      description:
        "Earliest local date (YYYY-MM-DD, inclusive): a `day` entry's date, else its start_time's date in tz",
    }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(NOTE_LINK_SUGGESTIONS_PAGE_MAX_LIMIT)
      .optional()
      .meta({
        description: `How many journal entries to look at (1–${NOTE_LINK_SUGGESTIONS_PAGE_MAX_LIMIT}, default ${NOTE_LINK_SUGGESTIONS_PAGE_DEFAULT_LIMIT}); only those with a suggestion are returned`,
      }),
    to: dateOnlySchema.optional().meta({ description: 'Latest local date (YYYY-MM-DD, inclusive)' }),
    tz: ianaTimezoneSchema.optional().meta({
      description:
        "IANA timezone every date of the answer is read in: from/to, each entry's day (for the night's sleep and the same day's activities) and the labels (default: the user's timezone)",
    }),
    unlinked_only: queryBooleanSchema.optional().meta({
      description:
        'true (the default) leaves out the entries already related to anything; false includes them',
    }),
  })
  .check((ctx) => {
    const query = ctx.value
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      pushIssue(ctx, 'to', query.to, 'to must not precede from')
    }
  })
  .meta({ id: 'NoteLinkSuggestionsPageQuery' })

export type NoteLinkSuggestionsPageQuery = z.infer<typeof noteLinkSuggestionsPageQuerySchema>

export const noteLinkSuggestionsEntrySchema = z
  .object({
    date: noteDateSchema.optional(),
    entity_type: z.enum(['time', 'day']).meta({ description: 'A journal entry at a time, or for a day' }),
    excerpt: z.string().meta({
      description: `The first non-empty line of the text, at most ${JOURNAL_ENTRY_EXCERPT_MAX} characters (may be empty)`,
    }),
    id: z.string().uuid().meta({ description: 'Note ID' }),
    related: z.array(noteRelatedSchema).meta({ description: 'What the entry is already related to' }),
    start_time: iso8601DateTimeSchema.optional().meta({ description: 'When a `time` entry is anchored' }),
    suggestions: z.array(noteLinkSuggestionSchema).meta({ description: 'The links suggested for it' }),
    title: noteTitleResponseSchema.optional(),
    updated_at: iso8601DateTimeSchema.meta({
      description: "The entry's `updated_at`, to pass as `expected_updated_at` when saving its links",
    }),
  })
  .meta({ description: 'A journal entry with the links suggested for it', id: 'NoteLinkSuggestionsEntry' })

export type NoteLinkSuggestionsEntry = z.infer<typeof noteLinkSuggestionsEntrySchema>

export const noteLinkSuggestionsPageSchema = z
  .object({
    entries: z.array(noteLinkSuggestionsEntrySchema).meta({
      description: 'The entries of this page that have at least one suggestion, newest first',
    }),
    next_cursor: z.string().optional().meta({
      description:
        'Cursor of the next page; absent when this is the last. A page may hold fewer entries than `limit`, or none, while there are more pages.',
    }),
  })
  .meta({
    description:
      'A page of journal entries, newest first, with the links suggested for each: only the entries with a suggestion are listed, so a page may be shorter than `limit` (or empty) while `next_cursor` is still set',
    id: 'NoteLinkSuggestionsPage',
  })

export type NoteLinkSuggestionsPage = z.infer<typeof noteLinkSuggestionsPageSchema>

export const noteLinkSuggestionsPageResponseSchema = createDataResponseSchema(
  noteLinkSuggestionsPageSchema,
).meta({ id: 'NoteLinkSuggestionsPageResponse' })

export type NoteLinkSuggestionsPageResponse = z.infer<typeof noteLinkSuggestionsPageResponseSchema>
