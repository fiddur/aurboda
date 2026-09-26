import type {
  ActivitySession,
  ActivitySessionGroup,
  DataFieldDefinition,
  DataSchemaDefinition,
  HrZoneSecs,
  ValueDistribution,
} from '@aurboda/api-spec'

export type SessionSortKey = 'date' | 'duration' | 'avg_hr' | 'max_hr' | 'hard_minutes'
export type GroupSortKey = 'recent' | 'count' | 'duration' | 'avg_hr' | 'hard_minutes' | 'name'

export const categoricalFields = (schema: DataSchemaDefinition | undefined): DataFieldDefinition[] =>
  schema?.fields.filter((f) => f.is_categorical) ?? []

export const fieldLabel = (field: Pick<DataFieldDefinition, 'label' | 'name'>): string =>
  field.label ?? field.name.charAt(0).toUpperCase() + field.name.slice(1).replaceAll('_', ' ')

export const formatMinutes = (minutes: number): string => {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest > 0 ? `${h} h ${rest} min` : `${h} h`
}

/** Median length, with the range when the sessions differ, e.g. "26 min (20–30)". */
export const groupDurationLabel = (group: ActivitySessionGroup): string | undefined => {
  if (group.duration_median === undefined) return undefined
  const median = formatMinutes(group.duration_median)
  const { duration_max: max, duration_min: min } = group
  return min !== undefined && max !== undefined && min !== max ? `${median} (${min}–${max})` : median
}

/** Minutes at zone 3 or above: one exertion number that tells a gentle yin from a sweaty flow. */
export const hardMinutes = (zones: HrZoneSecs | undefined): number | undefined =>
  zones ? Math.round((zones[3] + zones[4] + zones[5]) / 60) : undefined

export const zoneTotal = (zones: HrZoneSecs): number =>
  zones[0] + zones[1] + zones[2] + zones[3] + zones[4] + zones[5]

/** A shared bpm axis for box plots side by side, widened to tens with a little room at both ends. */
export const hrDomain = (dists: (ValueDistribution | undefined)[]): [number, number] | null => {
  const present = dists.filter((d): d is ValueDistribution => d !== undefined)
  if (present.length === 0) return null
  const lo = Math.min(...present.map((d) => d.min))
  const hi = Math.max(...present.map((d) => d.max))
  return [Math.floor((lo - 2) / 10) * 10, Math.ceil((hi + 2) / 10) * 10]
}

/** The label a session is recognised by: its categorical values, else its title. */
export const sessionLabel = (session: ActivitySession, fields: DataFieldDefinition[]): string | undefined => {
  const values = fields.flatMap((f) => {
    const v = session.fields[f.name]
    return v === undefined ? [] : [String(v)]
  })
  return values.length > 0 ? values.join(' · ') : session.title
}

type Comparable = number | string | undefined

/** Missing values sort last in either direction. */
const compare = (a: Comparable, b: Comparable, desc: boolean): number => {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1
  const order = typeof a === 'string' ? a.localeCompare(String(b)) : a - (b as number)
  return desc ? -order : order
}

const sessionSortValue = (s: ActivitySession, key: SessionSortKey): Comparable => {
  switch (key) {
    case 'date':
      return s.start_time
    case 'duration':
      return s.duration
    case 'avg_hr':
      return s.avg_hr
    case 'max_hr':
      return s.max_hr
    case 'hard_minutes':
      return hardMinutes(s.hr_zone_secs)
  }
}

export const sortSessions = (
  sessions: ActivitySession[],
  key: SessionSortKey,
  desc = true,
): ActivitySession[] =>
  sessions.toSorted((a, b) => compare(sessionSortValue(a, key), sessionSortValue(b, key), desc))

const groupHardMinutesPerSession = (g: ActivitySessionGroup): number | undefined => {
  const total = hardMinutes(g.hr_zone_secs)
  return total === undefined ? undefined : total / g.count
}

const groupSortValue = (g: ActivitySessionGroup, key: GroupSortKey): Comparable => {
  switch (key) {
    case 'recent':
      return g.last_start_time
    case 'count':
      return g.count
    case 'duration':
      return g.duration_median
    case 'avg_hr':
      return g.avg_hr_median
    case 'hard_minutes':
      return groupHardMinutesPerSession(g)
    case 'name':
      return g.value === null ? undefined : String(g.value)
  }
}

/** Name sorts ascending, everything else descending; the no-value group always stays last. */
export const sortGroups = (groups: ActivitySessionGroup[], key: GroupSortKey): ActivitySessionGroup[] =>
  groups.toSorted((a, b) => {
    if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1
    return compare(groupSortValue(a, key), groupSortValue(b, key), key !== 'name')
  })

/** Average hard minutes per session in a group, rounded. */
export const groupHardMinutes = (g: ActivitySessionGroup): number | undefined => {
  const v = groupHardMinutesPerSession(g)
  return v === undefined ? undefined : Math.round(v)
}

/** Whether `session` is the activity on screen: a detail page may show any one source of a merged session. */
export const isSameSession = (session: ActivitySession, start: Date): boolean => {
  const sStart = new Date(session.start_time).getTime()
  const sEnd = session.end_time ? new Date(session.end_time).getTime() : sStart
  return start.getTime() >= sStart && start.getTime() <= sEnd
}

/** The categorical fields this activity has a value for, trimmed as the backend compares them. */
export const categoricalValues = (
  fields: DataFieldDefinition[],
  data: Record<string, unknown> | undefined,
): { field: DataFieldDefinition; value: string }[] =>
  fields.flatMap((field) => {
    const v = data?.[field.name]
    if (typeof v === 'string') return v.trim() === '' ? [] : [{ field, value: v.trim() }]
    if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') {
      return [{ field, value: String(v) }]
    }
    return []
  })
