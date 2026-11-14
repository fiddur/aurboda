import type { ActivityItemGroup, ActivityItemHistory, ExerciseCatalogEntry } from '@aurboda/api-spec'

import { type QueryClient, useQuery } from '@tanstack/react-query'
import { subDays } from 'date-fns'

import type { LiveApi } from './saveQueue'

import { isSameName } from '../../components/knownValueSuggestions'
import {
  addActivity,
  fetchActivities,
  fetchActivityItemHistory,
  fetchActivityRecords,
  fetchActivitySessions,
  fetchItemValueIdentity,
  updateActivity,
} from '../../state/api'
import { muscleTiers } from '../ActivityTypeItem/catalogEntryView'
import { SETS_PATH, STRENGTH_QUERY_KEYS, STRENGTH_TYPE } from './constants'
import { isInProgress, type SetRow } from './sessionModel'
import { REPEAT_DAYS } from './startModel'

const FIVE_MIN = 5 * 60 * 1000

export const invalidateStrengthQueries = (queryClient: QueryClient): Promise<unknown> =>
  Promise.all([
    ...STRENGTH_QUERY_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('timeline-') }),
  ])

const findOpen = async (startTime: string): Promise<string | undefined> => {
  const start = new Date(startTime)
  const rows = await fetchActivities(new Date(start.getTime() - 1000), new Date(start.getTime() + 1000), [
    STRENGTH_TYPE,
  ])
  return rows.find((a) => a.start_time.getTime() === start.getTime() && isInProgress(a.data))?.id
}

export const liveApi: LiveApi = {
  create: async (body) => {
    const response = await addActivity(body)
    const id = response.data?.id
    if (!response.success || !id) throw new Error(response.error ?? 'The session could not be created')
    return id
  },
  findOpen,
  update: async (id, body) => {
    await updateActivity(id, body)
  },
}

export const useRecentStrengthSessions = () =>
  useQuery({
    queryFn: () => fetchActivities(subDays(new Date(), REPEAT_DAYS), new Date(), [STRENGTH_TYPE]),
    queryKey: ['activities', STRENGTH_TYPE, 'strength-recent'],
    staleTime: 60 * 1000,
  })

export const useSessionHistory = (id: string | undefined) =>
  useQuery({
    enabled: Boolean(id),
    queryFn: () => fetchActivityItemHistory(id ?? '', SETS_PATH),
    queryKey: ['activity-item-history', id, SETS_PATH],
    staleTime: FIVE_MIN,
  })

export const groupFor = (
  history: ActivityItemHistory | undefined,
  exercise: string,
): ActivityItemGroup | undefined => history?.groups.find((g) => isSameName(g.value, exercise))

export interface LastTime {
  start_time: string
  items: SetRow[]
}

const useLastTimeFromSessions = (exercise: string, excludeId: string | undefined, enabled: boolean) =>
  useQuery({
    enabled: enabled && exercise !== '',
    queryFn: () => fetchActivitySessions(STRENGTH_TYPE, { filter_field: SETS_PATH, filter_value: exercise }),
    queryKey: ['activity-sessions', STRENGTH_TYPE, SETS_PATH, 'filter', exercise],
    select: (data): LastTime | undefined => {
      const session = data.sessions.find((s) => s.id !== excludeId && !s.id.endsWith(`:${excludeId}`))
      return session ? { items: session.items ?? [], start_time: session.start_time } : undefined
    },
    staleTime: FIVE_MIN,
  })

const useBestE1rm = (exercise: string) =>
  useQuery({
    enabled: exercise !== '',
    queryFn: () => fetchActivityRecords(STRENGTH_TYPE, { filter_field: SETS_PATH, filter_value: exercise }),
    queryKey: ['activity-records', STRENGTH_TYPE, SETS_PATH, exercise],
    select: (data) => data.records.find((r) => r.measure === 'e1rm')?.value,
    staleTime: FIVE_MIN,
  })

const useCatalogEntry = (exercise: string) =>
  useQuery({
    enabled: exercise !== '',
    queryFn: () => fetchItemValueIdentity(STRENGTH_TYPE, SETS_PATH, exercise),
    queryKey: ['item-value-identity', STRENGTH_TYPE, SETS_PATH, exercise],
    select: (identity): ExerciseCatalogEntry | undefined => identity?.entry ?? undefined,
    staleTime: FIVE_MIN,
  })

export const useExerciseMuscles = (exercise: string): string | undefined => {
  const entry = useCatalogEntry(exercise)
  const primary = entry.data ? muscleTiers(entry.data).primary : []
  return primary.length > 0 ? primary.join(', ') : undefined
}

export interface ExerciseContext {
  lastTime?: LastTime
  bestE1rm?: number
  muscles?: string
}

/** What the page knows about an exercise from the server: absent offline, cached per exercise. */
export const useExerciseContext = (
  exercise: string,
  group: ActivityItemGroup | undefined,
  sessionId: string | undefined,
): ExerciseContext => {
  const previous = group?.previous
  const fromSessions = useLastTimeFromSessions(exercise, sessionId, !previous)
  const best = useBestE1rm(exercise)
  return {
    bestE1rm: best.data,
    lastTime: previous ? { items: previous.items, start_time: previous.start_time } : fromSessions.data,
    muscles: useExerciseMuscles(exercise),
  }
}
