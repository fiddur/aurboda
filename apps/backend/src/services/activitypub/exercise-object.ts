/**
 * The AS2 `content` for an exercise-share post (#1398): the exercise name and its activity type as
 * a heading, the author's note shaped for Mastodon like article prose (`renderNoteProse`), then — per
 * the author's opt-ins — the records with the session count, the latest sessions' sets, and the
 * public exercise page as a plain link when it was published. Built from the data resolved when
 * the Note is built, so a delivered Note carries the values as of delivery.
 */
import type { ExerciseShare, SharedExerciseData } from '@aurboda/api-spec'

import { activityMeasureLabels } from '@aurboda/api-spec'

import { escapeXml } from '../charts/chart-svg.ts'
import { formatExerciseLine, formatExerciseSet, formatMeasureValue } from '../feed-exercises.ts'
import {
  resolveStructuredExercise,
  SHARED_SESSION_COUNT,
  type StructuredExerciseDeps,
  type StructuredExercisePost,
} from '../feed-structured-exercise.ts'
import { getUserTimezone } from '../settings.ts'
import { renderNoteProse } from './note-prose.ts'

export interface ExerciseSnapshot {
  activity_type_name: string
  data: SharedExerciseData
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

/** `21 Dec 2025` in the owner's timezone; an invalid stored timezone falls back to UTC. */
export const formatExerciseDate = (iso: string, timeZone: string): string => {
  const date = new Date(iso)
  try {
    return new Intl.DateTimeFormat('en-GB', { ...DATE_OPTIONS, timeZone }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...DATE_OPTIONS, timeZone: 'UTC' }).format(date)
  }
}

const recordLines = (data: SharedExerciseData, timeZone: string): string[] => {
  const lines = data.records.map((record) => {
    const when = [formatExerciseDate(record.start_time, timeZone)]
    if (record.set) when.push(formatExerciseSet(record.set))
    const label = activityMeasureLabels[record.measure]
    return `${label} ${formatMeasureValue(record.measure, record.value)} (${when.join(', ')})`
  })
  const done = data.done
  if (done) {
    const first = formatExerciseDate(done.first, timeZone)
    lines.push(done.count === 1 ? `1 session, ${first}` : `${done.count} sessions since ${first}`)
  }
  return lines
}

const sessionLines = (data: SharedExerciseData, timeZone: string): string[] =>
  data.history.slice(0, SHARED_SESSION_COUNT).map((row) =>
    formatExerciseLine({
      measures: row.measures,
      name: formatExerciseDate(row.start_time, timeZone),
      records: row.records,
      sets: row.items,
    }),
  )

const linesParagraph = (lines: string[]): string[] =>
  lines.length === 0 ? [] : [`<p>${lines.map(escapeXml).join('<br>')}</p>`]

/**
 * The Note `content` HTML. Without a snapshot (the exercise could not be resolved) it carries the
 * name, the note and the link only.
 */
export const renderExerciseShareHtml = (
  exercise: ExerciseShare,
  snapshot: ExerciseSnapshot | null,
  message: string | null,
  timeZone: string,
): string => {
  const heading = snapshot
    ? `<p><strong>${escapeXml(exercise.name)}</strong> · ${escapeXml(snapshot.activity_type_name)}</p>`
    : `<p><strong>${escapeXml(exercise.name)}</strong></p>`
  const parts = [heading]
  if (message) parts.push(renderNoteProse(message))
  if (snapshot) {
    if (exercise.include_records) parts.push(...linesParagraph(recordLines(snapshot.data, timeZone)))
    if (exercise.include_sessions) parts.push(...linesParagraph(sessionLines(snapshot.data, timeZone)))
  }
  if (exercise.url != null) {
    parts.push(
      `<p><a href="${escapeXml(exercise.url)}" rel="nofollow noopener noreferrer" target="_blank">${escapeXml(exercise.url)}</a></p>`,
    )
  }
  return parts.join('\n')
}

export interface ExerciseNoteContentDeps {
  structured?: StructuredExerciseDeps
  getUserTimezone: (user: string) => Promise<string>
}

const defaultContentDeps: ExerciseNoteContentDeps = { getUserTimezone }

/** Resolve the exercise and render its Note content; a resolve failure renders name, note and link only. */
export const exerciseNoteContent = async (
  user: string,
  post: Omit<StructuredExercisePost, 'kind'> & { exercise: ExerciseShare },
  deps: ExerciseNoteContentDeps = defaultContentDeps,
): Promise<string> => {
  const [structured, timeZone] = await Promise.all([
    resolveStructuredExercise(user, { ...post, kind: 'exercise' }, deps.structured).catch((error) => {
      console.warn(`⚠️ Exercise share content for ${user} could not be resolved:`, error)
      return null
    }),
    deps.getUserTimezone(user).catch(() => 'UTC'),
  ])
  const snapshot = structured && { activity_type_name: structured.activity_type_name, data: structured.data }
  return renderExerciseShareHtml(post.exercise, snapshot, post.message, timeZone)
}
