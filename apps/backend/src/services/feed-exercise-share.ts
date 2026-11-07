/**
 * Resolve what an exercise-share post points at (#1398) — shared by the REST `POST /feed/exercises`
 * (and its preview) and the MCP `share_exercise` / `preview_exercise_share` tools (parity). The name
 * and link come from the server: the link only when the exercise is published as a shared exercise
 * and the author asked for it, so a post never links a page that does not exist.
 */
import type { ExerciseShare, FeedStructuredExerciseShare, ShareExerciseBody } from '@aurboda/api-spec'

import { findSharedExercise } from '../db/index.ts'
import { renderExerciseShareHtml } from './activitypub/exercise-object.ts'
import { hashtagLinks, linkifyHashtags } from './activitypub/hashtag-html.ts'
import { resolveStructuredExercise } from './feed-structured-exercise.ts'
import { normalizeFeedMessage } from './feed.ts'
import { exerciseKindTag, resolvePostTags } from './post-tags.ts'
import { queryActivitySessions } from './queries/activity-sessions.ts'
import { getUserTimezone } from './settings.ts'
import { buildShareUrl } from './share-urls.ts'
import { assertItemPath } from './shared-exercises.ts'

export interface ExerciseShareDeps {
  assertItemPath: typeof assertItemPath
  hasSessions: (user: string, activityType: string, field: string, value: string) => Promise<boolean>
  findSharedExercise: (
    user: string,
    activityType: string,
    field: string,
    value: string,
  ) => Promise<{ name: string; slug: string } | null>
}

const defaultDeps: ExerciseShareDeps = {
  assertItemPath,
  findSharedExercise: (user, activityType, field, value) =>
    findSharedExercise(user, activityType, field, value),
  hasSessions: async (user, activityType, field, value) =>
    (await queryActivitySessions(user, activityType, { filter: { field, value } })).sessions.length > 0,
}

export type ExerciseShareSource = Pick<
  ShareExerciseBody,
  'activity_type' | 'field' | 'include_link' | 'include_records' | 'include_sessions' | 'value'
>

export type ResolvedExerciseShare =
  | { ok: true; exercise: ExerciseShare }
  | { ok: false; error: string; status: 400 | 404 }

export const resolveExerciseShare = async (
  user: string,
  body: ExerciseShareSource,
  webHost: string | undefined,
  deps: ExerciseShareDeps = defaultDeps,
): Promise<ResolvedExerciseShare> => {
  const rejection = await deps.assertItemPath(user, body.activity_type, body.field)
  if (rejection) return { error: rejection.error, ok: false, status: rejection.status }
  if (!(await deps.hasSessions(user, body.activity_type, body.field, body.value))) {
    return { error: 'No sessions with that exercise', ok: false, status: 404 }
  }
  const shared = await deps.findSharedExercise(user, body.activity_type, body.field, body.value)
  const url = shared && body.include_link && webHost ? buildShareUrl(webHost, user, shared.slug) : undefined
  return {
    exercise: {
      activity_type: body.activity_type,
      field: body.field,
      include_records: body.include_records,
      include_sessions: body.include_sessions,
      name: shared?.name ?? body.value,
      value: body.value,
      ...(url === undefined ? {} : { url }),
    },
    ok: true,
  }
}

/** The tags an exercise post gets: the explicit ones, else the defaults and the exercise's name; plus typed ones. */
export const exerciseShareTags = (
  user: string,
  exercise: ExerciseShare,
  body: Pick<ShareExerciseBody, 'message' | 'tags'>,
): Promise<string[]> =>
  resolvePostTags(user, {
    explicit: body.tags,
    kindTag: exerciseKindTag(exercise),
    texts: [normalizeFeedMessage(body.message)],
  })

export type ExerciseSharePreview =
  | { ok: true; content: string; structured?: FeedStructuredExerciseShare; tags: string[] }
  | { ok: false; error: string; status: 400 | 404 }

/** What sharing the exercise with these opt-ins WOULD federate, creating nothing. */
export const previewExerciseShare = async (
  user: string,
  body: ExerciseShareSource & Pick<ShareExerciseBody, 'include_chart' | 'message' | 'tags'>,
  webHost: string | undefined,
  deps: ExerciseShareDeps = defaultDeps,
): Promise<ExerciseSharePreview> => {
  const resolved = await resolveExerciseShare(user, body, webHost, deps)
  if (!resolved.ok) return resolved
  const message = normalizeFeedMessage(body.message) ?? null
  const [structured, timeZone, tags] = await Promise.all([
    resolveStructuredExercise(user, {
      exercise: resolved.exercise,
      include_chart: body.include_chart,
      kind: 'exercise',
      message,
    }),
    getUserTimezone(user),
    exerciseShareTags(user, resolved.exercise, body),
  ])
  const snapshot = structured && { activity_type_name: structured.activity_type_name, data: structured.data }
  const content = linkifyHashtags(
    renderExerciseShareHtml(resolved.exercise, snapshot, message, timeZone),
    webHost ? hashtagLinks(webHost, user, tags) : undefined,
  )
  return { content, ok: true, tags, ...(structured == null ? {} : { structured }) }
}
