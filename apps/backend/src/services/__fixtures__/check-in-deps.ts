import type { CustomMetricDefinition, DataSchemaDefinition } from '@aurboda/api-spec'

import type { CheckInFormRecord, CheckInFormVersionRecord, CheckInRecord } from '../../db/index.ts'
import type { CheckInDeps } from '../check-ins.ts'

import { loadMetricCatalog } from '../metric-catalog.ts'

export interface FakeActivity {
  id: string
  activity_type: string
  data: Record<string, unknown>
  start_time: Date
  external_id: string
  deleted: boolean
  deleted_at?: Date
  /** Set on an override: the activities it edits. */
  override_target_ids?: string[]
}

export interface FakePoint {
  metric: string
  time: string
  value: number
  unit?: string
}

/** An in-memory stand-in for the check-in tables, the metric writes and the notifier. */
export const fakeCheckInDeps = (
  options: {
    now?: Date
    timezone?: string
    /** Activity types the user has, with their schemas; `medication` and `supplement` stand in for the catalogue. */
    activityTypes?: Record<string, DataSchemaDefinition | undefined>
  } = {},
) => {
  let now = options.now ?? new Date('2026-11-20T10:00:00Z')
  let ids = 0
  const nextId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
  const forms = new Map<string, CheckInFormRecord>()
  const versions = new Map<string, CheckInFormVersionRecord[]>()
  const checkIns = new Map<
    string,
    Omit<CheckInRecord, 'form_name' | 'live_activity_ids' | 'questions' | 'score_definition'>
  >()
  const activities = new Map<string, FakeActivity>()
  const doseSchema: DataSchemaDefinition = {
    fields: [
      { name: 'substance', type: 'string' },
      { min: 0, name: 'dose', type: 'number' },
      { name: 'dose_unit', type: 'string' },
    ],
  }
  const activityTypes = options.activityTypes ?? { medication: doseSchema, supplement: doseSchema }
  const points: FakePoint[] = []
  const forgotten: { metric: string; time: string }[] = []
  const customMetrics: CustomMetricDefinition[] = []
  const raised: Parameters<CheckInDeps['raise']>[1][] = []
  const markedRead: [string, readonly string[]][] = []
  const mutated: [string, Date, Date][] = []
  const locks = new Map<string, Promise<unknown>>()
  const catalog = loadMetricCatalog()

  const joined = (id: string): CheckInRecord | null => {
    const row = checkIns.get(id)
    if (!row) return null
    const form = forms.get(row.form_id)!
    const version = versions.get(row.form_id)!.find((v) => v.version === row.form_version)!
    return {
      ...row,
      form_name: form.name,
      live_activity_ids: Object.values(row.activity_ids).filter(
        (activityId) => activities.get(activityId)?.deleted === false,
      ),
      questions: version.questions,
      score_definition: version.score,
    }
  }

  const span = ({ activity_type, start_time }: FakeActivity) => ({
    activity_type,
    end_time: null,
    start_time,
  })

  const deps: CheckInDeps = {
    activityIsLive: async (_user, id) => activities.get(id)?.deleted === false,
    activityMutated: (_user, activityType, start, end) => {
      mutated.push([activityType, start, end])
    },
    activityTypeSchema: async (_user, activityType) =>
      activityType in activityTypes ? { schema: activityTypes[activityType] } : undefined,
    addActivity: async (_user, input, onMutated) => {
      if (input.data.dose !== undefined && (input.data.dose as number) < 0) {
        return { error: 'Data validation failed: dose below 0', success: false }
      }
      const id = nextId()
      activities.set(id, { ...input, deleted: false, id })
      onMutated?.(_user, input.activity_type, input.start_time, input.start_time)
      return { id, success: true }
    },
    catalog: () => catalog,
    createMetric: async (_user, definition) => {
      customMetrics.push(definition)
    },
    deleteActivity: async (_user, id) => {
      const activity = activities.get(id)
      if (!activity || activity.deleted) return null
      activity.deleted = true
      activity.deleted_at = now
      return span(activity)
    },
    deletePoints: async (_user, removed) => {
      for (const point of removed) {
        const index = points.findIndex((p) => p.metric === point.metric && p.time === point.time)
        if (index !== -1) points.splice(index, 1)
      }
    },
    deleteSkips: async (_user, formId, scheduledFor) => {
      for (const [id, row] of checkIns) {
        if (
          row.form_id === formId &&
          row.status === 'skipped' &&
          row.deleted_at === null &&
          row.scheduled_for?.getTime() === scheduledFor.getTime()
        ) {
          checkIns.delete(id)
        }
      }
    },
    forgetPoints: async (_user, removed) => {
      forgotten.push(...removed)
    },
    getCheckIn: async (_user, id) => joined(id),
    getCustomMetrics: async () => [...customMetrics],
    getForm: async (_user, id) => forms.get(id) ?? null,
    getTimezone: async () => options.timezone ?? 'Europe/Stockholm',
    insertCheckIn: async (_user, input) => {
      const id = nextId()
      checkIns.set(id, {
        ...input,
        created_at: now,
        deleted_at: null,
        id,
        updated_at: now,
      })
      return joined(id)!
    },
    insertForm: async (_user, input) => {
      const id = nextId()
      const form: CheckInFormRecord = {
        ...input,
        archived: false,
        created_at: now,
        deleted_at: null,
        id,
        updated_at: now,
        version: 1,
      }
      forms.set(id, form)
      versions.set(id, [{ created_at: now, questions: input.questions, score: input.score, version: 1 }])
      return form
    },
    listCheckIns: async (_user, query) =>
      [...checkIns.keys()]
        .map((id) => joined(id)!)
        .filter((row) => (query.deleted ? row.deleted_at !== null : row.deleted_at === null))
        .filter((row) => !query.form_id || row.form_id === query.form_id)
        .filter(
          (row) =>
            !query.entity || (row.entity_type === query.entity.type && row.entity_id === query.entity.id),
        )
        .filter((row) => !query.from || row.answered_at >= query.from)
        .filter((row) => !query.to || row.answered_at < query.to)
        .sort((a, b) => b.answered_at.getTime() - a.answered_at.getTime() || b.id.localeCompare(a.id))
        .filter(
          (row) =>
            !query.before ||
            row.answered_at.getTime() < new Date(query.before.ts).getTime() ||
            (row.answered_at.getTime() === new Date(query.before.ts).getTime() && row.id < query.before.id),
        )
        .slice(0, query.limit)
        .map((row) => ({ ...row, cursor_ts: row.answered_at.toISOString() })),
    listFormCheckInsBetween: async (_user, formId, from, to) =>
      [...checkIns.values()]
        .filter((row) => row.form_id === formId && row.deleted_at === null)
        .filter(
          (row) =>
            (row.answered_at >= from && row.answered_at < to) ||
            (row.scheduled_for !== null && row.scheduled_for >= from && row.scheduled_for < to),
        )
        .map(({ answered_at, answers, id, scheduled_for, status }) => ({
          answered_at,
          answers,
          id,
          scheduled_for,
          status,
        })),
    listForms: async (_user, query) =>
      [...forms.values()].filter((form) =>
        query.deleted ? form.deleted_at !== null : form.deleted_at === null,
      ),
    listVersions: async (_user, formId) => versions.get(formId) ?? [],
    markDueRead: async (_user, formId, scheduledFor) => {
      markedRead.push([formId, scheduledFor])
    },
    now: () => now,
    overridesOf: async (_user, activityIds, deletedSince) =>
      [...activities.values()]
        .filter(
          (activity) =>
            activity.override_target_ids?.every((target) => activityIds.includes(target)) &&
            (deletedSince ? activity.deleted && activity.deleted_at! >= deletedSince : !activity.deleted),
        )
        .map((activity) => activity.id),
    raise: async (_user, input) => {
      raised.push(input)
    },
    restoreActivity: async (_user, id) => {
      const activity = activities.get(id)
      if (!activity?.deleted) return null
      activity.deleted = false
      delete activity.deleted_at
      return span(activity)
    },
    restoreForm: async (_user, id, notBefore) => {
      const form = forms.get(id)
      if (!form?.deleted_at) return null
      const next = { ...form, deleted_at: null, schedule_not_before: notBefore }
      forms.set(id, next)
      return next
    },
    setCheckInDeleted: async (_user, id, deleted) => {
      const row = checkIns.get(id)
      if (!row || (row.deleted_at !== null) === deleted) return false
      checkIns.set(id, { ...row, deleted_at: deleted ? now : null, ...(deleted ? { logged: {} } : {}) })
      return true
    },
    softDeleteForm: async (_user, id) => {
      const form = forms.get(id)
      if (!form || form.deleted_at) return null
      const next = { ...form, deleted_at: now }
      forms.set(id, next)
      return next
    },
    updateCheckIn: async (_user, id, patch) => {
      const row = checkIns.get(id)
      if (!row) return null
      checkIns.set(id, { ...row, ...patch, updated_at: now })
      return joined(id)
    },
    updateForm: async (_user, id, patch, { newVersion }) => {
      const form = forms.get(id)
      if (!form) return null
      const next = { ...form, ...patch, updated_at: now, version: form.version + (newVersion ? 1 : 0) }
      forms.set(id, next)
      const list = versions.get(id)!
      if (newVersion) {
        list.push({ created_at: now, questions: next.questions, score: next.score, version: next.version })
      } else if (patch.questions || patch.score !== undefined) {
        const current = list.find((v) => v.version === next.version)!
        current.questions = next.questions
        current.score = next.score
      }
      return next
    },
    withFormLock: <T>(_user: string, formId: string, fn: () => Promise<T>): Promise<T> => {
      const run = (locks.get(formId) ?? Promise.resolve()).then(fn)
      locks.set(
        formId,
        run.catch(() => undefined),
      )
      return run
    },
    writePoints: async (_user, items) => {
      const errors: { index: number; error: string }[] = []
      items.forEach((item, index) => {
        if (item.metric === 'refused') {
          errors.push({ error: 'Refused', index })
          return
        }
        points.push({
          metric: item.metric,
          time: item.time.toISOString(),
          value: item.value,
          ...(item.unit ? { unit: item.unit } : {}),
        })
      })
      return { errors, inserted: items.length - errors.length, success: true }
    },
  }

  return {
    activities,
    checkIns,
    customMetrics,
    deps,
    forgotten,
    forms,
    markedRead,
    mutated,
    points,
    raised,
    setNow: (date: Date) => {
      now = date
    },
    versions,
  }
}
