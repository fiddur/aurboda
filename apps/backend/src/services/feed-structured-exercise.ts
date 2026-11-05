/**
 * The structured payload of an exercise-share post (#1398): the exercise's progress as its public
 * page projects it (`resolveSharedExerciseData`), resolved from the post's stored pointer when the
 * payload is read and filtered by the author's opt-ins, so nothing the author left out leaves the
 * instance.
 */
import type {
  ActivityMeasure,
  ExerciseShare,
  FeedStructuredExerciseShare,
  SharedExerciseData,
} from '@aurboda/api-spec'

import type { FeedPostRecord } from '../db/index.ts'

import { getActivityTypeDefinition } from '../db/index.ts'
import { resolveSharedExerciseData } from './shared-exercise-data.ts'

export const SHARED_SESSION_COUNT = 5

export interface StructuredExerciseDeps {
  resolveSharedExerciseData: (
    user: string,
    share: Pick<ExerciseShare, 'activity_type' | 'field' | 'value'>,
  ) => Promise<SharedExerciseData>
  getActivityTypeDefinition: (user: string, name: string) => Promise<{ display_name?: string | null } | null>
}

const defaultDeps: StructuredExerciseDeps = {
  getActivityTypeDefinition: (user, name) => getActivityTypeDefinition(user, name),
  resolveSharedExerciseData: (user, share) => resolveSharedExerciseData(user, share),
}

export type StructuredExercisePost = Pick<FeedPostRecord, 'exercise' | 'include_chart' | 'kind' | 'message'>

/** The projection with everything the author did not opt into left out. */
export const filterExerciseData = (
  data: SharedExerciseData,
  exercise: Pick<ExerciseShare, 'include_records' | 'include_sessions'>,
  includeChart: boolean,
): SharedExerciseData => ({
  done: exercise.include_records ? data.done : null,
  history: exercise.include_sessions ? data.history.slice(0, SHARED_SESSION_COUNT) : [],
  per_week: includeChart ? data.per_week : null,
  records: exercise.include_records ? data.records : [],
  trend: includeChart ? data.trend : null,
})

/** Null when the post is not an exercise post, or the exercise has no sessions any more. */
export const resolveStructuredExercise = async (
  user: string,
  post: StructuredExercisePost,
  deps: StructuredExerciseDeps = defaultDeps,
): Promise<FeedStructuredExerciseShare | null> => {
  if (post.kind !== 'exercise' || post.exercise == null) return null
  const exercise = post.exercise
  const [data, definition] = await Promise.all([
    deps.resolveSharedExerciseData(user, exercise),
    deps.getActivityTypeDefinition(user, exercise.activity_type),
  ])
  if (data.done == null) return null
  return {
    activity_type: exercise.activity_type,
    activity_type_name: definition?.display_name ?? exercise.activity_type,
    data: filterExerciseData(data, exercise, post.include_chart),
    kind: 'exercise',
    name: exercise.name,
    ...(post.message != null ? { message: post.message } : {}),
    ...(exercise.url != null ? { url: exercise.url } : {}),
  }
}

export interface ExerciseTrendSeries {
  measure: ActivityMeasure
  series: [Date, number][]
}

/** The trend line `trend.png` draws, or null when the chart is off or has fewer than 2 points. */
export const resolveExerciseTrendSeries = async (
  user: string,
  post: StructuredExercisePost,
  deps: StructuredExerciseDeps = defaultDeps,
): Promise<ExerciseTrendSeries | null> => {
  if (!post.include_chart) return null
  const trend = (await resolveStructuredExercise(user, post, deps))?.data.trend
  if (trend == null || trend.history.length < 2) return null
  return {
    measure: trend.measure,
    series: trend.history.map((point): [Date, number] => [new Date(point.date), point.value]),
  }
}
