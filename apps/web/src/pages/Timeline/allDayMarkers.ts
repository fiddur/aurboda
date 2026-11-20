import type { ImportantDate, Note } from '@aurboda/api-spec'

import { importantDateTitle, yearsPhrase } from '../People/people-view'
import { commentLabel } from './commentItems'

/**
 * Something that belongs to a whole calendar date rather than a moment: a journal entry without a
 * time of day today, an important date later. Drawn at the start of its date.
 */
export interface AllDayMarker {
  /** YYYY-MM-DD, a local calendar date. */
  date: string
  kind: AllDayMarkerKind
  label: string
  href?: string
  onClick?: () => void
}

export type AllDayMarkerKind = 'journal' | 'important_date'

export const ALL_DAY_MARKER_ICONS: Record<AllDayMarkerKind, string> = { important_date: '🎉', journal: '📓' }

export const journalEntryHref = (id: string): string => `/journal/${encodeURIComponent(id)}`

/** The `day` journal entries among the Timeline's comment roots, one marker each. */
export const journalDayMarkers = (notes: readonly Note[]): AllDayMarker[] =>
  notes.flatMap((note) =>
    note.entity_type === 'day' && note.date && note.id
      ? [
          {
            date: note.date,
            href: journalEntryHref(note.id),
            kind: 'journal' as const,
            label: note.title?.trim() || commentLabel(note.content) || 'Journal entry',
          },
        ]
      : [],
  )

/** A person's birthday or other date, opening the person. */
export const importantDateMarkers = (dates: readonly ImportantDate[]): AllDayMarker[] =>
  dates.map((date) => {
    const years = yearsPhrase(date.kind, date.years)
    return {
      date: date.date,
      href: `/people/${encodeURIComponent(date.person.id)}`,
      kind: 'important_date' as const,
      label: years ? `${importantDateTitle(date)} (${years})` : importantDateTitle(date),
    }
  })

/** Where a tap on a group goes: the one marker's page, else the journal's date or the People page. */
export const markerGroupHref = (group: AllDayMarkerGroup): string | undefined => {
  const [first] = group.markers
  if (group.markers.length === 1) return first?.href
  return group.markers.every((m) => m.kind === 'important_date')
    ? '/people'
    : `/journal?date=${encodeURIComponent(group.date)}`
}

/** Local midnight at the start of a YYYY-MM-DD date. */
export const startOfLocalDate = (date: string): Date => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

export interface AllDayMarkerGroup {
  date: string
  /** Position of the date's start along the time axis, in pixels. */
  pos: number
  markers: AllDayMarker[]
}

/**
 * One group per date, in date order, positioned at the date's start, or at the window's start while
 * the date is under way there; groups closer than `minPx` to the previous one are dropped onto it,
 * so glyphs never pile up when zoomed out. Dates outside [from, to] are left out.
 */
export const layoutAllDayMarkers = (
  markers: readonly AllDayMarker[],
  toPos: (at: Date) => number,
  window: { from: Date; to: Date },
  minPx: number,
): AllDayMarkerGroup[] => {
  const byDate = new Map<string, AllDayMarker[]>()
  for (const marker of markers) {
    const list = byDate.get(marker.date)
    if (list) list.push(marker)
    else byDate.set(marker.date, [marker])
  }
  const groups: AllDayMarkerGroup[] = []
  for (const date of [...byDate.keys()].sort()) {
    const at = startOfLocalDate(date)
    const next = startOfLocalDate(date)
    next.setDate(next.getDate() + 1)
    if (next <= window.from || at > window.to) continue
    const pos = toPos(at < window.from ? window.from : at)
    const previous = groups.at(-1)
    if (previous && pos - previous.pos < minPx) previous.markers.push(...byDate.get(date)!)
    else groups.push({ date, markers: [...byDate.get(date)!], pos })
  }
  return groups
}

/** What a group's tooltip says: each marker's label, under a count when there are several. */
export const markerGroupTitle = (group: AllDayMarkerGroup): string =>
  group.markers.length === 1 ? group.markers[0]!.label : `${group.markers.length} entries`

/** A group's glyph: its kind's icon when every marker shares one kind. */
export const markerGroupIcon = (group: AllDayMarkerGroup): string => {
  const kinds = new Set(group.markers.map((m) => m.kind))
  return kinds.size === 1 ? ALL_DAY_MARKER_ICONS[group.markers[0]!.kind] : '📌'
}
