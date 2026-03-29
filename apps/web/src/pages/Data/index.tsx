import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatISO } from 'date-fns'
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
  fetchTags,
  type Activity,
  type Meal,
  type Place,
  type ProductivityRecord,
  type Report,
  type Tag,
} from '../../state/api'
import './style.css'

// ── Types ──────────────────────────────────────────────────────────────────

type ItemType = 'activity' | 'tag' | 'location' | 'music' | 'meal' | 'report' | 'screentime'

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

const TAG_COLOR = '#f59e0b'
const LOCATION_COLOR = '#6366f1'
const MUSIC_COLOR = '#ec4899'
const MEAL_COLOR = '#ef4444'
const REPORT_COLOR = '#14b8a6'
const SCREENTIME_COLOR = '#8b5cf6'

// ── Helpers ────────────────────────────────────────────────────────────────

const formatDuration = (start: Date, end: Date): string => {
  const ms = end.getTime() - start.getTime()
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

const activityToItem = (a: Activity): DataItem => {
  const end = a.end_time ?? new Date(a.start_time.getTime() + 60 * 60000)
  const label =
    a.activity_type === 'exercise'
      ? (a.title ?? 'Exercise')
      : a.activity_type === 'meditation'
        ? (a.title ?? 'Meditation')
        : a.activity_type === 'sleep'
          ? 'Sleep'
          : a.activity_type === 'rest'
            ? 'Rest'
            : 'Nap'
  return {
    color: ACTIVITY_COLORS[a.activity_type] ?? '#6b7280',
    detail: `${format(a.start_time, 'HH:mm')} – ${format(end, 'HH:mm')} · ${formatDuration(a.start_time, end)}`,
    end,
    href: a.id ? `/detail/activity/${encodeURIComponent(a.id)}` : undefined,
    label,
    start: a.start_time,
    type: 'activity',
  }
}

const tagToItem = (t: Tag): DataItem => ({
  color: TAG_COLOR,
  detail: t.end_time
    ? `${format(t.start_time, 'HH:mm')} – ${format(t.end_time, 'HH:mm')} · ${formatDuration(t.start_time, t.end_time)}`
    : format(t.start_time, 'HH:mm'),
  end: t.end_time,
  href: t.id ? `/detail/tag/${encodeURIComponent(t.id)}` : undefined,
  label: t.tag,
  start: t.start_time,
  type: 'tag',
})

const placeToItem = (p: Place, dateStr: string): DataItem => ({
  color: LOCATION_COLOR,
  detail: `${format(p.start_time, 'HH:mm')} – ${format(p.end_time, 'HH:mm')} · ${formatDuration(p.start_time, p.end_time)}`,
  end: p.end_time,
  href: `/places?date=${dateStr}&name=${encodeURIComponent(p.region)}`,
  label: p.region,
  start: p.start_time,
  type: 'location',
})

const mealToItem = (m: Meal): DataItem => {
  const parts = [format(m.time, 'HH:mm')]
  if (m.meal_type) parts.push(m.meal_type)
  if (m.calories) parts.push(`${Math.round(m.calories)} kcal`)
  return {
    color: MEAL_COLOR,
    detail: parts.join(' · '),
    href: `/meals/${m.id}`,
    label: m.name ?? m.meal_type ?? 'Meal',
    start: m.time,
    type: 'meal',
  }
}

const reportToItem = (r: Report): DataItem => ({
  color: REPORT_COLOR,
  detail: `${format(r.date, 'HH:mm')} · ${r.entries?.length ?? 0} entries`,
  href: `/reports/${r.id}`,
  label: r.report_type,
  start: r.date,
  type: 'report',
})

const productivityToItem = (p: ProductivityRecord): DataItem => {
  const dur = Math.round(p.duration_sec / 60)
  const category = p.resolved_category?.join(' > ') ?? p.category ?? ''
  return {
    color: SCREENTIME_COLOR,
    detail: `${format(p.start_time, 'HH:mm')} – ${format(p.end_time, 'HH:mm')} · ${dur}m${category ? ` · ${category}` : ''}`,
    end: p.end_time,
    href: p.id ? `/detail/productivity/${encodeURIComponent(p.id)}` : undefined,
    label: p.activity,
    start: p.start_time,
    type: 'screentime',
  }
}

// ── Component ──────────────────────────────────────────────────────────────

const ALL_TYPES: ItemType[] = ['activity', 'tag', 'location', 'music', 'meal', 'report', 'screentime']

const TYPE_LABELS: Record<ItemType, string> = {
  activity: 'Activities',
  location: 'Locations',
  meal: 'Meals',
  music: 'Music',
  report: 'Reports',
  screentime: 'Screen Time',
  tag: 'Tags',
}

const TYPE_COLORS: Record<ItemType, string> = {
  activity: ACTIVITY_COLORS.sleep!,
  location: LOCATION_COLOR,
  meal: MEAL_COLOR,
  music: MUSIC_COLOR,
  report: REPORT_COLOR,
  screentime: SCREENTIME_COLOR,
  tag: TAG_COLOR,
}

const buildItems = (
  activeTypes: Set<ItemType>,
  activities: Activity[],
  tags: Tag[],
  places: Place[],
  scrobbles: { artist: string; recorded_at: Date; track: string }[],
  meals: Meal[],
  reports: Report[],
  productivity: ProductivityRecord[],
  dateStr: string,
): DataItem[] => {
  const items: DataItem[] = []
  if (activeTypes.has('activity')) {
    for (const a of activities) items.push(activityToItem(a))
  }
  if (activeTypes.has('tag')) {
    for (const t of tags) items.push(tagToItem(t))
  }
  if (activeTypes.has('location')) {
    for (const p of places) items.push(placeToItem(p, dateStr))
  }
  if (activeTypes.has('music')) {
    for (const s of scrobbles) {
      items.push({
        color: MUSIC_COLOR,
        detail: `${format(s.recorded_at, 'HH:mm')} · ${s.artist}`,
        label: s.track,
        start: s.recorded_at,
        type: 'music',
      })
    }
  }
  if (activeTypes.has('meal')) {
    for (const m of meals) items.push(mealToItem(m))
  }
  if (activeTypes.has('report')) {
    for (const r of reports) items.push(reportToItem(r))
  }
  if (activeTypes.has('screentime')) {
    for (const p of productivity) items.push(productivityToItem(p))
  }
  return items.sort((a, b) => a.start.getTime() - b.start.getTime())
}

const parseUrlState = (query: Record<string, string>): { date: string; hidden: Set<ItemType> } => {
  const date = query.date ?? formatISO(new Date(), { representation: 'date' })
  const hideStr = query.hide ?? ''
  const hidden = new Set<ItemType>(hideStr ? (hideStr.split(',') as ItemType[]) : [])
  return { date, hidden }
}

const syncUrl = (dateStr: string, hidden: Set<ItemType>) => {
  const params = new URLSearchParams()
  params.set('date', dateStr)
  if (hidden.size > 0) params.set('hide', [...hidden].join(','))
  history.replaceState(null, '', `${window.location.pathname}?${params}`)
}

// eslint-disable-next-line complexity -- data page with multiple query sources
export const Data = () => {
  const { query } = useLocation()
  const initial = parseUrlState(query)

  const [dateStr, setDateStr] = useState(initial.date)
  const [hiddenTypes, setHiddenTypes] = useState<Set<ItemType>>(initial.hidden)

  const activeTypes = new Set(ALL_TYPES.filter((t) => !hiddenTypes.has(t)))

  // Sync URL on state changes
  useEffect(() => {
    syncUrl(dateStr, hiddenTypes)
  }, [dateStr, hiddenTypes])

  // Compute day boundaries in the browser's timezone for the specific date.
  // Using ISO string with explicit time avoids DST issues where date-fns startOfDay/endOfDay
  // would use the current timezone offset instead of the offset on the viewed date.
  const start = new Date(`${dateStr}T00:00:00`)
  const end = new Date(`${dateStr}T23:59:59.999`)

  // Cancel in-flight queries when date changes
  const queryClient = useQueryClient()
  const handleDateChange = useCallback(
    (newDate: string) => {
      queryClient.cancelQueries({ queryKey: ['data-activities'] })
      queryClient.cancelQueries({ queryKey: ['data-tags'] })
      queryClient.cancelQueries({ queryKey: ['data-places'] })
      queryClient.cancelQueries({ queryKey: ['data-scrobbles'] })
      queryClient.cancelQueries({ queryKey: ['data-meals'] })
      queryClient.cancelQueries({ queryKey: ['data-reports'] })
      queryClient.cancelQueries({ queryKey: ['data-productivity'] })
      setDateStr(newDate)
    },
    [queryClient],
  )

  const activitiesQuery = useQuery({
    enabled: activeTypes.has('activity'),
    queryFn: () => fetchActivities(start, end, ['sleep', 'exercise', 'meditation', 'nap', 'rest']),
    queryKey: ['data-activities', dateStr],
    staleTime: 5 * 60 * 1000,
  })

  const tagsQuery = useQuery({
    enabled: activeTypes.has('tag'),
    queryFn: () => fetchTags(start, end),
    queryKey: ['data-tags', dateStr],
    staleTime: 5 * 60 * 1000,
  })

  const placesQuery = useQuery({
    enabled: activeTypes.has('location'),
    queryFn: () => fetchPlaces(start, end),
    queryKey: ['data-places', dateStr],
    staleTime: 5 * 60 * 1000,
  })

  const scrobblesQuery = useQuery({
    enabled: activeTypes.has('music'),
    queryFn: () => fetchScrobbles(start, end),
    queryKey: ['data-scrobbles', dateStr],
    staleTime: 5 * 60 * 1000,
  })

  const mealsQuery = useQuery({
    enabled: activeTypes.has('meal'),
    queryFn: () => fetchMeals({ start: start.toISOString(), end: end.toISOString() }),
    queryKey: ['data-meals', dateStr],
    staleTime: 5 * 60 * 1000,
  })

  const reportsQuery = useQuery({
    enabled: activeTypes.has('report'),
    queryFn: () => fetchReports({ start: start.toISOString(), end: end.toISOString() }),
    queryKey: ['data-reports', dateStr],
    staleTime: 5 * 60 * 1000,
  })

  const productivityQuery = useQuery({
    enabled: activeTypes.has('screentime'),
    queryFn: () => fetchProductivity(start, end),
    queryKey: ['data-productivity', dateStr],
    staleTime: 5 * 60 * 1000,
  })

  // Only check loading/fetching for enabled queries
  const queries = [
    { enabled: activeTypes.has('activity'), query: activitiesQuery },
    { enabled: activeTypes.has('tag'), query: tagsQuery },
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

  const allItems = buildItems(
    activeTypes,
    activitiesQuery.data ?? [],
    tagsQuery.data ?? [],
    placesQuery.data ?? [],
    scrobblesQuery.data ?? [],
    mealsQuery.data?.meals ?? [],
    reportsQuery.data ?? [],
    productivityQuery.data ?? [],
    dateStr,
  )

  return (
    <div class="data-page">
      <div class="data-sidebar">
        <DateNav value={dateStr} onChange={handleDateChange} dateFormat="EEE MMM d, yyyy" />
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
            {allItems.length === 0 && <p class="data-status">No data for this day</p>}
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
