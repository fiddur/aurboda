import type {
  ActivityRecord,
  ActivityRecords,
  ActivityRecordsQuery,
  ActivitySession,
} from '@aurboda/api-spec'

import { recordMeasures } from '@aurboda/api-spec'

import { measureSet } from './activity-measures.ts'
import { toSharedSet } from './feed-exercises.ts'
import { queryActivitySessions, sessionsOptionsFromQuery } from './queries/activity-sessions.ts'

export interface ActivityRecordsDeps {
  queryActivitySessions: typeof queryActivitySessions
}

const defaultDeps: ActivityRecordsDeps = { queryActivitySessions }

export type PublicActivityRecord = Omit<ActivityRecord, 'session_id'>

const oldestFirst = (sessions: ActivitySession[]): ActivitySession[] =>
  sessions.toSorted((a, b) => a.start_time.localeCompare(b.start_time))

/** The best value of each record measure, with the first session (oldest first) that reached it. */
export const recordsOf = (ordered: ActivitySession[]): ActivityRecord[] =>
  recordMeasures.flatMap((measure) => {
    let best: ActivitySession | undefined
    for (const s of ordered) {
      const v = s.measures?.[measure]
      if (v !== undefined && (best === undefined || v > (best.measures?.[measure] ?? -Infinity))) best = s
    }
    const value = best?.measures?.[measure]
    if (best === undefined || value === undefined) return []
    const set = measureSet(best.items ?? [], measure)
    return [
      {
        measure,
        session_id: best.id,
        start_time: best.start_time,
        value,
        ...(set && { set: toSharedSet(set) }),
      },
    ]
  })

export const publicRecord = ({ session_id: _sessionId, ...record }: ActivityRecord): PublicActivityRecord =>
  record

export const getActivityRecords = async (
  user: string,
  activityType: string,
  query: ActivityRecordsQuery,
  deps: ActivityRecordsDeps = defaultDeps,
): Promise<ActivityRecords> => {
  const { sessions } = await deps.queryActivitySessions(user, activityType, sessionsOptionsFromQuery(query))
  return { activity_type: activityType, records: recordsOf(oldestFirst(sessions)) }
}
