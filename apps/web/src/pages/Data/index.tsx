import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatISO, subDays } from 'date-fns'
import { useLocation } from 'preact-iso'
import { useCallback, useEffect, useState } from 'preact/hooks'

import { DateNav } from '../../components/DateNav'
import {
  fetchActivities,
  fetchMeals,
  fetchPlaces,
  fetchProductivity,
  fetchReports,
  fetchScrobbles,
  type Activity,
  type Meal,
  type Place,
  type ProductivityRecord,
  type Report,
} from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { MEAL_LOCATION_WINDOW_MS } from '../EntityDetail/LocationInfo'
import './style.css'

// ── Types ──────────────────────────────────────────────────────────────────

type ItemType = 'activity' | 'location' | 'music' | 'meal' | 'report' | 'screentime'

interface DataItem {
  color: string
  detail: string
  end?: Date
  href?: string
  label: string
  start: Date
  type: ItemType
}

// ── Colors ─────────────────────────────────────────────────────────────────

const ACTIVITY_COLORS: Record<string, string> = {
  exercise: '#10b981',
  meditation: '#a855f7',
  nap: '#60a5fa',
  rest: '#86efac',
  sleep: '#3b82f6',
}

const LOCATION_COLOR = '#6366f1'
const MUSIC_COLOR = '#ec4899'
const MEAL_COLOR = '#ef4444'
const REPORT_COLOR = '#14b8a6'
const SCREENTIME_COLOR = '#8b5cf6'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Format a time, including date prefix when the view spans multiple days. */
const formatTime = (date: Date, multiDay: boolean): string =>
  multiDay ? format(date, 'MMM d HH:mm') : format(date, 'HH:mm')

const formatDuration = (start: Date, end: Date): string => {
  const ms = end.getTime() - start.getTime()
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/** Find the place with the most overlap for a given time window. */
const findPrimaryPlace = (start: Date, end: Date, places: Place[]): string | undefined => {
  let best: { name: string; overlap: number } | undefined
  for (const p of places) {
    const overlapStart = Math.max(start.getTime(), p.start_time.getTime())
    const overlapEnd = Math.min(end.getTime(), p.end_time.getTime())
    const overlap = overlapEnd - overlapStart
    if (overlap > 0 && (!best || overlap > best.overlap)) {
      best = { name: p.region, overlap }
    }
  }
  return best?.name
}

const activityToItem = (a: Activity, places: Place[], multiDay: boolean): DataItem => {
  const end = a.end_time ?? new Date(a.start_time.getTime() + 60 * 60000)
  const label = a.title ?? toDisplayName(a.activity_type)
  const location = findPrimaryPlace(a.start_time, end, places)
  const timeStr = `${formatTime(a.start_time, multiDay)} – ${formatTime(end, multiDay)} · ${formatDuration(a.start_time, end)}`
  return {
    color: ACTIVITY_COLORS[a.activity_type] ?? '#6b7280',
    detail: location ? `${timeStr} · @ ${location}` : timeStr,
    end,
    href: a.id ? `/detail/activity/${encodeURIComponent(a.id)}` : undefined,
    label,
    start: a.start_time,
    type: 'activity',
  }
}

const placeToItem = (p: Place, dateStr: string, multiDay: boolean): DataItem => ({
  color: LOCATION_COLOR,
  detail: `${formatTime(p.start_time, multiDay)} – ${formatTime(p.end_time, multiDay)} · ${formatDuration(p.start_time, p.end_time)}`,
  end: p.end_time,
  href: `/places?date=${dateStr}&name=${encodeURIComponent(p.region)}`,
  label: p.region,
  start: p.start_time,
  type: 'location',
})

const mealToItem = (m: Meal, places: Place[], multiDay: boolean): DataItem => {
  const parts = [formatTime(m.time, multiDay)]
  if (m.meal_type) parts.push(m.meal_type)
  if (m.calories) parts.push(`${Math.round(m.calories)} kcal`)
  const location = findPrimaryPlace(m.time, new Date(m.time.getTime() + MEAL_LOCATION_WINDOW_MS), places)
  if (location) parts.push(`@ ${location}`)
  return {
    color: MEAL_COLOR,
    detail: parts.join(' · '),
    href: `/meals/${m.id}`,
    label: m.name ?? m.meal_type ?? 'Meal',
    start: m.time,
    type: 'meal',
  }
}

const reportToItem = (r: Report, multiDay: boolean): DataItem => ({
  color: REPORT_COLOR,
  detail: `${formatTime(r.date, multiDay)} · ${r.entries?.length ?? 0} entries`,
  href: `/reports/${r.id}`,
  label: r.report_type,
  start: r.date,
  type: 'report',
})

const productivityToItem = (p: ProductivityRecord, places: Place[], multiDay: boolean): DataItem => {
  const dur = Math.round(p.duration_sec / 60)
  const category = p.resolved_category?.join(' > ') ?? p.category ?? ''
  const location = findPrimaryPlace(p.start_time, p.end_time, places)
  const parts = [`${formatTime(p.start_time, multiDay)} – ${formatTime(p.end_time, multiDay)} · ${dur}m`]
  if (category) parts.push(category)
  if (location) parts.push(`@ ${location}`)
  return {
    color: SCREENTIME_COLOR,
    detail: parts.join(' · '),
    end: p.end_time,
    href: p.id ? `/detail/productivity/${encodeURIComponent(p.id)}` : undefined,
    label: p.activity,
    start: p.start_time,
    type: 'screentime',
  }
}

// ── Component ──────────────────────────────────────────────────────────────

const ALL_TYPES: ItemType[] = ['activity', 'location', 'music', 'meal', 'report', 'screentime']

const TYPE_LABELS: Record<ItemType, string> = {
  activity: 'Activities',
  location: 'Locations',
  meal: 'Meals',
  music: 'Music',
  report: 'Reports',
  screentime: 'Screen Time',
}

const TYPE_COLORS: Record<ItemType, string> = {
  activity: ACTIVITY_COLORS.sleep!,
  location: LOCATION_COLOR,
  meal: MEAL_COLOR,
  music: MUSIC_COLOR,
  report: REPORT_COLOR,
  screentime: SCREENTIME_COLOR,
}

const buildItems = (
  activeTypes: Set<ItemType>,
  activities: Activity[],
  places: Place[],
  scrobbles: { artist: string; recorded_at: Date; track: string }[],
  meals: Meal[],
  reports: Report[],
  productivity: ProductivityRecord[],
  dateStr: string,
  multiDay: boolean,
): DataItem[] => {
  const items: DataItem[] = []
  if (activeTypes.has('activity')) {
    for (const a of activities) items.push(activityToItem(a, places, multiDay))
  }
  if (activeTypes.has('location')) {
    for (const p of places) items.push(placeToItem(p, dateStr, multiDay))
  }
  if (activeTypes.has('music')) {
    for (const s of scrobbles) {
      items.push({
        color: MUSIC_COLOR,
        detail: `${formatTime(s.recorded_at, multiDay)} · ${s.artist}`,
        label: s.track,
        start: s.recorded_at,
        type: 'music',
      })
    }
  }
  if (activeTypes.has('meal')) {
    for (const m of meals) items.push(mealToItem(m, places, multiDay))
  }
  if (activeTypes.has('report')) {
    for (const r of reports) items.push(reportToItem(r, multiDay))
  }
  if (activeTypes.has('screentime')) {
    for (const p of productivity) items.push(productivityToItem(p, places, multiDay))
  }
  return items.sort((a, b) => a.start.getTime() - b.start.getTime())
}

interface UrlState {
  dataFilter: string | undefined
  date: string
  deductionRuleId: string | undefined
  from: string | undefined
  hidden: Set<ItemType>
  to: string | undefined
  types: string | undefined
}

const parseUrlState = (query: Record<string, string>): UrlState => {
  const date = query.date ?? formatISO(new Date(), { representation: 'date' })
  const hideStr = query.hide ?? ''
  const hidden = new Set<ItemType>(hideStr ? (hideStr.split(',') as ItemType[]) : [])
  const from = query.from || undefined
  const to = query.to || undefined
  const types = query.types || undefined
  const dataFilter = query.data_filter || undefined
  const deductionRuleId = query.deduction_rule_id || undefined
  return { dataFilter, date, deductionRuleId, from, hidden, to, types }
}

const syncUrl = (
  dateStr: string,
  hidden: Set<ItemType>,
  from?: string,
  to?: string,
  types?: string,
  dataFilter?: string,
  deductionRuleId?: string,
) => {
  const params = new URLSearchParams()
  params.set('date', dateStr)
  if (hidden.size > 0) params.set('hide', [...hidden].join(','))
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (types) params.set('types', types)
  if (dataFilter) params.set('data_filter', dataFilter)
  if (deductionRuleId) params.set('deduction_rule_id', deductionRuleId)
  history.replaceState(null, '', `${window.location.pathname}?${params}`)
}

// eslint-disable-next-line complexity -- data page with multiple query sources
export const Data = () => {
  const { query, route } = useLocation()
  const initial = parseUrlState(query)

  const [dateStr, setDateStr] = useState(initial.date)
  const [hiddenTypes, setHiddenTypes] = useState<Set<ItemType>>(initial.hidden)
  const [timeFrom, setTimeFrom] = useState<string | undefined>(initial.from)
  const [timeTo, setTimeTo] = useState<string | undefined>(initial.to)
  const [typesFilter, setTypesFilter] = useState<string | undefined>(initial.types)
  const [dataFilter, setDataFilter] = useState<string | undefined>(initial.dataFilter)
  const [deductionRuleId, setDeductionRuleId] = useState<string | undefined>(initial.deductionRuleId)

  const hasTimeFilter = Boolean(timeFrom || timeTo)
  const hasDataFilter = Boolean(typesFilter || dataFilter || deductionRuleId)
  const activeTypes = new Set(ALL_TYPES.filter((t) => !hiddenTypes.has(t)))

  // Sync URL on state changes
  useEffect(() => {
    syncUrl(dateStr, hiddenTypes, timeFrom, timeTo, typesFilter, dataFilter, deductionRuleId)
  }, [dateStr, hiddenTypes, timeFrom, timeTo, typesFilter, dataFilter, deductionRuleId])

  // Compute query boundaries — when filtering by deduction rule, show last 90 days.
  // Otherwise use time filter if present, or full day.
  const start = deductionRuleId
    ? subDays(new Date(`${dateStr}T23:59:59.999`), 90)
    : timeFrom
      ? new Date(timeFrom)
      : new Date(`${dateStr}T00:00:00`)
  const end = timeTo ? new Date(timeTo) : new Date(`${dateStr}T23:59:59.999`)

  // Cancel in-flight queries when date changes
  const queryClient = useQueryClient()
  const handleDateChange = useCallback(
    (newDate: string) => {
      queryClient.cancelQueries({ queryKey: ['data-activities'] })
      queryClient.cancelQueries({ queryKey: ['data-places'] })
      queryClient.cancelQueries({ queryKey: ['data-scrobbles'] })
      queryClient.cancelQueries({ queryKey: ['data-meals'] })
      queryClient.cancelQueries({ queryKey: ['data-reports'] })
      queryClient.cancelQueries({ queryKey: ['data-productivity'] })
      setDateStr(newDate)
      setTimeFrom(undefined)
      setTimeTo(undefined)
    },
    [queryClient],
  )

  const clearTimeFilter = useCallback(() => {
    setTimeFrom(undefined)
    setTimeTo(undefined)
  }, [])

  const clearDataFilter = useCallback(() => {
    setTypesFilter(undefined)
    setDataFilter(undefined)
    setDeductionRuleId(undefined)
  }, [])

  const activityTypes = typesFilter ? typesFilter.split(',') : undefined
  const activitiesQuery = useQuery({
    enabled: activeTypes.has('activity'),
    queryFn: () => fetchActivities(start, end, activityTypes, undefined, dataFilter, deductionRuleId),
    queryKey: ['data-activities', dateStr, timeFrom, timeTo, typesFilter, dataFilter, deductionRuleId],
    staleTime: 5 * 60 * 1000,
  })

  const placesQuery = useQuery({
    enabled: activeTypes.has('location'),
    queryFn: () => fetchPlaces(start, end),
    queryKey: ['data-places', dateStr, timeFrom, timeTo],
    staleTime: 5 * 60 * 1000,
  })

  const scrobblesQuery = useQuery({
    enabled: activeTypes.has('music'),
    queryFn: () => fetchScrobbles(start, end),
    queryKey: ['data-scrobbles', dateStr, timeFrom, timeTo],
    staleTime: 5 * 60 * 1000,
  })

  const mealsQuery = useQuery({
    enabled: activeTypes.has('meal'),
    queryFn: () => fetchMeals({ start: start.toISOString(), end: end.toISOString() }),
    queryKey: ['data-meals', dateStr, timeFrom, timeTo],
    staleTime: 5 * 60 * 1000,
  })

  const reportsQuery = useQuery({
    enabled: activeTypes.has('report'),
    queryFn: () => fetchReports({ start: start.toISOString(), end: end.toISOString() }),
    queryKey: ['data-reports', dateStr, timeFrom, timeTo],
    staleTime: 5 * 60 * 1000,
  })

  const productivityQuery = useQuery({
    enabled: activeTypes.has('screentime'),
    queryFn: () => fetchProductivity(start, end),
    queryKey: ['data-productivity', dateStr, timeFrom, timeTo],
    staleTime: 5 * 60 * 1000,
  })

  // Only check loading/fetching for enabled queries
  const queries = [
    { enabled: activeTypes.has('activity'), query: activitiesQuery },
    { enabled: activeTypes.has('location'), query: placesQuery },
    { enabled: activeTypes.has('music'), query: scrobblesQuery },
    { enabled: activeTypes.has('meal'), query: mealsQuery },
    { enabled: activeTypes.has('report'), query: reportsQuery },
    { enabled: activeTypes.has('screentime'), query: productivityQuery },
  ]
  const enabledQueries = queries.filter((q) => q.enabled)
  const isLoading = enabledQueries.some((q) => q.query.isLoading)
  const isFetching = enabledQueries.some((q) => q.query.isFetching)
  const isError = enabledQueries.some((q) => q.query.isError)

  const toggleType = (t: ItemType) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  // Auto-redirect to detail page when chart click leads to exactly 1 activity
  const activitiesLoaded = !activitiesQuery.isLoading && activitiesQuery.data
  useEffect(() => {
    if (hasDataFilter && activitiesLoaded && activitiesQuery.data?.length === 1) {
      const activity = activitiesQuery.data[0]
      if (activity.id) route(`/detail/activity/${activity.id}`)
    }
  }, [hasDataFilter, activitiesLoaded, activitiesQuery.data, route])

  const multiDay = end.getTime() - start.getTime() > 24 * 60 * 60 * 1000
  const allItems = buildItems(
    activeTypes,
    activitiesQuery.data ?? [],
    placesQuery.data ?? [],
    scrobblesQuery.data ?? [],
    mealsQuery.data?.meals ?? [],
    reportsQuery.data ?? [],
    productivityQuery.data?.records ?? [],
    dateStr,
    multiDay,
  )

  return (
    <div class="data-page">
      <div class="data-sidebar">
        <DateNav value={dateStr} onChange={handleDateChange} dateFormat="EEE MMM d, yyyy" />
        {hasTimeFilter && (
          <div class="data-time-filter">
            <span>
              {format(start, 'HH:mm')} – {format(end, 'HH:mm')}
            </span>
            <button type="button" onClick={clearTimeFilter} title="Clear time filter">
              &times;
            </button>
          </div>
        )}
        {hasDataFilter && (
          <div class="data-time-filter">
            <span>
              {deductionRuleId
                ? `Rule: ${deductionRuleId.slice(0, 8)}…`
                : `${typesFilter ?? ''} ${dataFilter ? `(${dataFilter})` : ''}`}
            </span>
            <button type="button" onClick={clearDataFilter} title="Clear data filter">
              &times;
            </button>
          </div>
        )}
        <div class="data-type-filters">
          {ALL_TYPES.map((t) => (
            <button
              key={t}
              class={`data-type-btn${activeTypes.has(t) ? ' active' : ''}`}
              onClick={() => toggleType(t)}
              type="button"
              style={activeTypes.has(t) ? { borderColor: TYPE_COLORS[t] } : undefined}
            >
              <span
                class="data-type-dot"
                style={{ background: activeTypes.has(t) ? TYPE_COLORS[t] : '#d1d5db' }}
              />
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <div class="data-main">
        {(isLoading || isFetching) && <p class="data-status">Loading…</p>}
        {isError && <p class="data-status data-error">Error loading data</p>}

        {!isLoading && !isFetching && !isError && (
          <div class="data-list">
            {allItems.length === 0 && (
              <p class="data-status">No data for this {hasTimeFilter ? 'time range' : 'day'}</p>
            )}
            {allItems.map((item, i) => {
              const El = item.href ? 'a' : 'div'
              return (
                <El
                  key={i}
                  class={`data-item${item.href ? ' clickable' : ''}`}
                  {...(item.href ? { href: item.href } : {})}
                >
                  <span class="data-dot" style={{ background: item.color }} />
                  <div class="data-item-content">
                    <span class="data-item-label">{item.label}</span>
                    <span class="data-item-detail">{item.detail}</span>
                  </div>
                </El>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
