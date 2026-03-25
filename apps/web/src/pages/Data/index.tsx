import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { addDays, endOfDay, format, formatISO, startOfDay, subDays } from 'date-fns'
import { useState } from 'preact/hooks'

import { DateNav } from '../../components/DateNav'
import {
  fetchActivities,
  fetchPlaces,
  fetchScrobbles,
  fetchTags,
  type Activity,
  type Place,
  type Tag,
} from '../../state/api'
import './style.css'

// ── Types ──────────────────────────────────────────────────────────────────

type ItemType = 'activity' | 'tag' | 'location' | 'music'

interface DataItem {
  color: string
  detail: string
  end?: Date
  entityId?: string
  entityType?: string
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
    entityId: a.id,
    entityType: 'activity',
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
  entityId: t.id,
  entityType: 'tag',
  label: t.tag,
  start: t.start_time,
  type: 'tag',
})

const placeToItem = (p: Place): DataItem => ({
  color: LOCATION_COLOR,
  detail: `${format(p.start_time, 'HH:mm')} – ${format(p.end_time, 'HH:mm')} · ${formatDuration(p.start_time, p.end_time)}`,
  end: p.end_time,
  label: p.region,
  start: p.start_time,
  type: 'location',
})

// ── Component ──────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ItemType, string> = {
  activity: 'Activities',
  location: 'Locations',
  music: 'Music',
  tag: 'Tags',
}

const TYPE_COLORS: Record<ItemType, string> = {
  activity: ACTIVITY_COLORS.sleep!,
  location: LOCATION_COLOR,
  music: MUSIC_COLOR,
  tag: TAG_COLOR,
}

const buildItems = (
  activeTypes: Set<ItemType>,
  activities: Activity[],
  tags: Tag[],
  places: Place[],
  scrobbles: { artist: string; recorded_at: Date; track: string }[],
): DataItem[] => {
  const items: DataItem[] = []
  if (activeTypes.has('activity')) {
    for (const a of activities) items.push(activityToItem(a))
  }
  if (activeTypes.has('tag')) {
    for (const t of tags) items.push(tagToItem(t))
  }
  if (activeTypes.has('location')) {
    for (const p of places) items.push(placeToItem(p))
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
  return items.sort((a, b) => a.start.getTime() - b.start.getTime())
}

// eslint-disable-next-line complexity -- data page with multiple query sources
export const Data = () => {
  const [dateStr, setDateStr] = useState(formatISO(new Date(), { representation: 'date' }))
  const [activeTypes, setActiveTypes] = useState<Set<ItemType>>(
    new Set(['activity', 'tag', 'location', 'music']),
  )

  const date = new Date(dateStr)
  const start = subDays(startOfDay(date), 0.5)
  const end = addDays(endOfDay(date), 0.5)

  const activitiesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchActivities(start, end, ['sleep', 'exercise', 'meditation', 'nap', 'rest']),
    queryKey: ['data-activities', dateStr],
    staleTime: 5 * 60 * 1000,
  })

  const tagsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchTags(start, end),
    queryKey: ['data-tags', dateStr],
    staleTime: 5 * 60 * 1000,
  })

  const placesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchPlaces(start, end),
    queryKey: ['data-places', dateStr],
    staleTime: 5 * 60 * 1000,
  })

  const scrobblesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchScrobbles(start, end),
    queryKey: ['data-scrobbles', dateStr],
    staleTime: 5 * 60 * 1000,
  })

  const isLoading =
    activitiesQuery.isLoading || tagsQuery.isLoading || placesQuery.isLoading || scrobblesQuery.isLoading
  const isError =
    activitiesQuery.isError || tagsQuery.isError || placesQuery.isError || scrobblesQuery.isError

  const toggleType = (t: ItemType) => {
    setActiveTypes((prev) => {
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
  )

  // Date navigation handled by DateNav component

  return (
    <div class="data-page">
      <div class="data-controls">
        <DateNav value={dateStr} onChange={setDateStr} dateFormat="EEE MMM d, yyyy" />
        <div class="data-type-filters">
          {(Object.entries(TYPE_LABELS) as [ItemType, string][]).map(([t, label]) => (
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
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p class="data-status">Loading…</p>}
      {isError && <p class="data-status data-error">Error loading data</p>}

      {!isLoading && !isError && (
        <div class="data-list">
          {allItems.length === 0 && <p class="data-status">No data for this day</p>}
          {allItems.map((item, i) => {
            const href =
              item.entityId && item.entityType
                ? `/detail/${item.entityType}/${encodeURIComponent(item.entityId)}`
                : undefined
            const El = href ? 'a' : 'div'
            return (
              <El key={i} class={`data-item${href ? ' clickable' : ''}`} {...(href ? { href } : {})}>
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
  )
}
