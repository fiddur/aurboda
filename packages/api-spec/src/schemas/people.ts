import { z } from 'zod'

import { activitySchema } from './activities.ts'
import { baseResponseSchema, dateOnlySchema, iso8601DateTimeSchema, queryBooleanSchema } from './common.ts'
import { timelineEntrySchema } from './feed.ts'
import { journalEntryRefsSchema } from './notes.ts'

export const PERSON_NAME_MAX = 120
export const PERSON_RELATIONSHIP_MAX = 60
export const PERSON_PRONOUNS_MAX = 40
export const PERSON_DATE_LABEL_MAX = 120
export const PERSON_NOTIFY_DAYS_MAX = 60

/** A soft-deleted person is removed for good this many days after its deletion. */
export const DELETED_PERSON_RETENTION_DAYS = 30

export const PERSON_RECENT_ACTIVITIES_LIMIT = 20
export const PERSON_POSTS_DEFAULT_LIMIT = 20
export const PERSON_POSTS_MAX_LIMIT = 50

export const IMPORTANT_DATES_DEFAULT_DAYS = 60
export const IMPORTANT_DATES_MAX_SPAN_DAYS = 400

export const personRelationshipSuggestions = [
  'partner',
  'child',
  'parent',
  'sibling',
  'friend',
  'colleague',
] as const

export const personDateKinds = ['birthday', 'anniversary', 'remembrance', 'other'] as const

export type PersonDateKind = (typeof personDateKinds)[number]

export const personDateKindSchema = z.enum(personDateKinds).meta({
  description: 'What a date is: `birthday`, `anniversary`, `remembrance` or `other`',
  example: 'anniversary',
  id: 'PersonDateKind',
})

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** A real month and day, in `year` when it is known; 29 February without a year is allowed. */
export const isValidMonthDay = (month: number, day: number, year?: number | null): boolean => {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false
  if (day > DAYS_IN_MONTH[month - 1]!) return false
  return !(month === 2 && day === 29 && year != null && !isLeapYear(year))
}

export interface MonthDayYear {
  month: number
  day: number
  year: number | null
}

const BIRTH_DATE_RE = /^(?:(\d{4})|-)-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` or `--MM-DD` (no year) as its parts; null when it is not a real date. */
export const parseBirthDate = (value: string): MonthDayYear | null => {
  const match = BIRTH_DATE_RE.exec(value)
  if (!match) return null
  const year = match[1] === undefined ? null : Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year !== null && year < 1) return null
  return isValidMonthDay(month, day, year) ? { day, month, year } : null
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** The API form of a month, day and optional year: `YYYY-MM-DD` or `--MM-DD`. */
export const formatBirthDate = ({ day, month, year }: MonthDayYear): string =>
  `${year === null ? '-' : pad(year, 4)}-${pad(month)}-${pad(day)}`

const HANDLE_RE = /^@?[^@\s]+@[^@\s]+$/

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PERSON_NAME_MAX)
  .meta({ description: 'What the user calls the person' })

const relationshipSchema = z
  .string()
  .trim()
  .max(PERSON_RELATIONSHIP_MAX)
  .meta({
    description: `Free text, e.g. one of ${personRelationshipSuggestions.join(', ')}`,
    example: 'friend',
  })

const pronounsSchema = z.string().trim().max(PERSON_PRONOUNS_MAX).meta({ example: 'she/her' })

const birthDateSchema = z
  .string()
  .refine(
    (value) => parseBirthDate(value) !== null,
    'Must be a real date as YYYY-MM-DD, or --MM-DD without a year',
  )
  .meta({
    description: 'Birthday: `YYYY-MM-DD`, or `--MM-DD` when the year is not known',
    example: '1990-04-12',
  })

const notifyDaysSchema = z.number().int().min(0).max(PERSON_NOTIFY_DAYS_MAX)

const birthdayNotifySchema = notifyDaysSchema.meta({
  description: `Days before the birthday to raise an \`important_date\` notification (0 = on the day, at most ${PERSON_NOTIFY_DAYS_MAX}); null for none`,
})

const handleSchema = z.string().trim().regex(HANDLE_RE, 'Must be a fediverse handle like @name@server').meta({
  description:
    'Fediverse handle (`@name@server` or `name@server`), resolved to the account it names. Never what identifies the person.',
  example: '@anna@example.social',
})

export const personActorSchema = z
  .object({
    following: z.boolean().meta({ description: 'Whether the user follows the account (an accepted follow)' }),
    handle: z.string().nullable().meta({ description: 'The handle, as last seen' }),
    icon: z.string().nullable().meta({ description: 'Avatar URL, as last seen' }),
    name: z.string().nullable().meta({ description: 'Display name, as last seen' }),
    uri: z.string().meta({ description: 'The actor URI the handle resolved to' }),
  })
  .meta({
    description:
      "The fediverse account of a person, read at query time from the user's follow, else the newest post in their timeline, else a cache",
    id: 'PersonActor',
  })

export type PersonActor = z.infer<typeof personActorSchema>

export const personSchema = z
  .object({
    actor: personActorSchema.nullable().meta({ description: 'The fediverse account, null without a handle' }),
    archived: z.boolean().meta({ description: 'Archived people are left out of lists and important dates' }),
    birth_date: z.string().nullable().meta({
      description: 'Birthday: `YYYY-MM-DD`, or `--MM-DD` without a year; null when not set',
    }),
    birthday_notify_days_before: z.number().int().nullable().meta({
      description: 'Days before the birthday an `important_date` notification is raised; null for none',
    }),
    created_at: iso8601DateTimeSchema,
    deleted_at: iso8601DateTimeSchema.optional().meta({
      description: 'When the person was deleted. Only in the list of deleted people and the restore answer.',
    }),
    id: z.string().uuid().meta({ description: 'Person ID' }),
    name: z.string(),
    pronouns: z.string().nullable(),
    purge_at: iso8601DateTimeSchema.optional().meta({
      description: `When a deleted person is removed for good (${DELETED_PERSON_RETENTION_DAYS} days after the deletion). Only in the list of deleted people.`,
    }),
    relationship: z.string().nullable(),
    updated_at: iso8601DateTimeSchema,
  })
  .meta({
    description: "A private profile of someone in the user's life. Never shared or federated.",
    id: 'Person',
  })

export type Person = z.infer<typeof personSchema>

export const personDateSchema = z
  .object({
    created_at: iso8601DateTimeSchema,
    day: z.number().int(),
    id: z.string().uuid().meta({ description: 'Date ID' }),
    kind: personDateKindSchema,
    label: z.string(),
    month: z.number().int(),
    notify_days_before: z.number().int().nullable().meta({
      description: 'Days before each occurrence an `important_date` notification is raised; null for none',
    }),
    person_id: z.string().uuid(),
    updated_at: iso8601DateTimeSchema,
    year: z.number().int().nullable().meta({ description: 'The year it first happened, if known' }),
  })
  .meta({ description: 'A yearly date that matters about a person', id: 'PersonDate' })

export type PersonDate = z.infer<typeof personDateSchema>

export const personDetailSchema = personSchema
  .extend({
    dates: z.array(personDateSchema).meta({ description: "The person's dates, by month and day" }),
    journal_entries: journalEntryRefsSchema.optional(),
    recent_activities: z.array(activitySchema).meta({
      description: `The ${PERSON_RECENT_ACTIVITIES_LIMIT} latest activities the person was with, newest first`,
    }),
  })
  .meta({ id: 'PersonDetail' })

export type PersonDetail = z.infer<typeof personDetailSchema>

export const addPersonBodySchema = z
  .object({
    archived: z.boolean().optional(),
    birth_date: birthDateSchema.nullable().optional(),
    birthday_notify_days_before: birthdayNotifySchema.nullable().optional(),
    handle: handleSchema.nullable().optional(),
    name: nameSchema,
    pronouns: pronounsSchema.nullable().optional(),
    relationship: relationshipSchema.nullable().optional(),
  })
  .meta({ description: 'A new person', id: 'AddPersonBody' })

export type AddPersonBody = z.infer<typeof addPersonBodySchema>

export const updatePersonBodySchema = z
  .object({
    archived: z.boolean().optional(),
    birth_date: birthDateSchema.nullable().optional().meta({ description: 'New birthday; null clears it' }),
    birthday_notify_days_before: birthdayNotifySchema.nullable().optional(),
    handle: handleSchema.nullable().optional().meta({ description: 'New fediverse handle; null clears it' }),
    name: nameSchema.optional(),
    pronouns: pronounsSchema.nullable().optional(),
    relationship: relationshipSchema.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Give at least one field to change',
    path: ['name'],
  })
  .meta({ description: 'Fields of a person to change; at least one', id: 'UpdatePersonBody' })

export type UpdatePersonBody = z.infer<typeof updatePersonBodySchema>

export const peopleQuerySchema = z
  .object({
    archived: queryBooleanSchema.optional().meta({ description: 'true includes archived people' }),
    deleted: queryBooleanSchema.optional().meta({
      description:
        'true lists the deleted people that can still be restored, with `deleted_at` and `purge_at`',
    }),
  })
  .meta({ id: 'PeopleQuery' })

export type PeopleQuery = z.infer<typeof peopleQuerySchema>

export const deletePersonQuerySchema = z
  .object({
    purge: queryBooleanSchema.optional().meta({
      description: `true removes the person, their dates, notes and activity links for good at once. Without it a delete can be undone for ${DELETED_PERSON_RETENTION_DAYS} days.`,
    }),
  })
  .meta({ id: 'DeletePersonQuery' })

export type DeletePersonQuery = z.infer<typeof deletePersonQuerySchema>

export const peopleResponseSchema = baseResponseSchema
  .extend({
    people: z.array(personSchema).optional(),
    relationship_suggestions: z.array(z.string()).optional(),
  })
  .meta({ id: 'PeopleResponse' })

export type PeopleResponse = z.infer<typeof peopleResponseSchema>

export const personResponseSchema = baseResponseSchema
  .extend({ person: personSchema.optional() })
  .meta({ id: 'PersonResponse' })

export type PersonResponse = z.infer<typeof personResponseSchema>

export const personDetailResponseSchema = baseResponseSchema
  .extend({ person: personDetailSchema.optional() })
  .meta({ id: 'PersonDetailResponse' })

export type PersonDetailResponse = z.infer<typeof personDetailResponseSchema>

const monthSchema = z.number().int().min(1).max(12)
const daySchema = z.number().int().min(1).max(31)
const yearSchema = z.number().int().min(1).max(9999)

export const addPersonDateBodySchema = z
  .object({
    day: daySchema,
    kind: personDateKindSchema.optional().meta({ description: 'Default `other`' }),
    label: z.string().trim().min(1).max(PERSON_DATE_LABEL_MAX).meta({ example: 'Wedding anniversary' }),
    month: monthSchema,
    notify_days_before: notifyDaysSchema
      .nullable()
      .optional()
      .meta({
        description: `Days before each occurrence to raise an \`important_date\` notification (0 = on the day, at most ${PERSON_NOTIFY_DAYS_MAX}); null or absent for none`,
      }),
    year: yearSchema.nullable().optional().meta({ description: 'The year it first happened, if known' }),
  })
  .refine((body) => isValidMonthDay(body.month, body.day, body.year), {
    message: 'Not a real date',
    path: ['day'],
  })
  .meta({ description: 'A new yearly date for a person', id: 'AddPersonDateBody' })

export type AddPersonDateBody = z.infer<typeof addPersonDateBodySchema>

export const updatePersonDateBodySchema = z
  .object({
    day: daySchema.optional(),
    kind: personDateKindSchema.optional(),
    label: z.string().trim().min(1).max(PERSON_DATE_LABEL_MAX).optional(),
    month: monthSchema.optional(),
    notify_days_before: notifyDaysSchema.nullable().optional().meta({ description: 'null switches it off' }),
    year: yearSchema.nullable().optional().meta({ description: 'null clears it' }),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Give at least one field to change',
    path: ['label'],
  })
  .meta({ description: 'Fields of a date to change; at least one', id: 'UpdatePersonDateBody' })

export type UpdatePersonDateBody = z.infer<typeof updatePersonDateBodySchema>

export const personDateResponseSchema = baseResponseSchema
  .extend({ date: personDateSchema.optional() })
  .meta({ id: 'PersonDateResponse' })

export type PersonDateResponse = z.infer<typeof personDateResponseSchema>

export const personDatesResponseSchema = baseResponseSchema
  .extend({ dates: z.array(personDateSchema).optional() })
  .meta({ id: 'PersonDatesResponse' })

export type PersonDatesResponse = z.infer<typeof personDatesResponseSchema>

export const importantDatesQuerySchema = z
  .object({
    from: dateOnlySchema
      .optional()
      .meta({ description: "First day (YYYY-MM-DD); default today in the user's zone" }),
    to: dateOnlySchema.optional().meta({
      description: `Last day (YYYY-MM-DD); default ${IMPORTANT_DATES_DEFAULT_DAYS} days after from. At most ${IMPORTANT_DATES_MAX_SPAN_DAYS} days after from.`,
    }),
  })
  .meta({ id: 'ImportantDatesQuery' })

export type ImportantDatesQuery = z.infer<typeof importantDatesQuerySchema>

export const importantDateSchema = z
  .object({
    date: z.string().meta({ description: 'The occurrence (YYYY-MM-DD)' }),
    date_id: z.string().uuid().nullable().meta({ description: "The date's ID; null for a birthday" }),
    kind: personDateKindSchema,
    label: z.string().meta({ example: "Anna's birthday" }),
    person: z.object({ id: z.string().uuid(), name: z.string() }),
    years: z.number().int().optional().meta({
      description:
        'Age, or years since, on this occurrence; only when the year is known and the count is positive',
    }),
  })
  .meta({
    description:
      "One occurrence of a person's date or birthday. 29 February falls on 28 February in other years.",
    id: 'ImportantDate',
  })

export type ImportantDate = z.infer<typeof importantDateSchema>

export const importantDatesResponseSchema = baseResponseSchema
  .extend({
    dates: z.array(importantDateSchema).optional(),
    from: z.string().optional(),
    timezone: z.string().optional(),
    to: z.string().optional(),
  })
  .meta({ id: 'ImportantDatesResponse' })

export type ImportantDatesResponse = z.infer<typeof importantDatesResponseSchema>

export const personPostsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PERSON_POSTS_MAX_LIMIT)
      .optional()
      .meta({
        description: `How many posts (default ${PERSON_POSTS_DEFAULT_LIMIT}, at most ${PERSON_POSTS_MAX_LIMIT})`,
      }),
  })
  .meta({ id: 'PersonPostsQuery' })

export type PersonPostsQuery = z.infer<typeof personPostsQuerySchema>

export const personPostsResponseSchema = baseResponseSchema
  .extend({ entries: z.array(timelineEntrySchema).optional() })
  .meta({ id: 'PersonPostsResponse' })

export type PersonPostsResponse = z.infer<typeof personPostsResponseSchema>
