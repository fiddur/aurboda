import type { PlacesSummary } from './schemas/locations.ts'
import type { TopMedia } from './schemas/media.ts'
import type { TopApps } from './schemas/productivity.ts'
import type { TopListCardData } from './schemas/social.ts'

const DAY_MS = 86_400_000

export type TopListFigures = Omit<TopListCardData, 'previous_total'>

/** Whole days of a window, at least one. */
export const windowDays = (start: Date, end: Date): number =>
  Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS))

export const topListFromMedia = (top: TopMedia): TopListFigures => ({
  distinct: top.distinct,
  items: top.items.map((i) => ({ count: i.plays, name: i.name })),
  per_day: null,
  total: top.total_plays,
  unit: 'plays',
})

export const topListFromApps = (top: TopApps, days: number): TopListFigures => ({
  distinct: top.distinct_apps,
  items: top.items.map((i) => ({ count: i.hours, name: i.name })),
  per_day: Math.round((top.total_hours / days) * 10) / 10,
  total: top.total_hours,
  unit: 'hours',
})

export const topListFromPlaces = (summary: PlacesSummary, limit: number): TopListFigures => ({
  distinct: summary.distinct_places,
  items: summary.places
    .toSorted((a, b) => b.visits - a.visits || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((p) => ({ count: p.visits, name: p.name })),
  per_day: null,
  total: summary.visits,
  unit: 'visits',
})
