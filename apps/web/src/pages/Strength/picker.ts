import type { ActivityFieldValue, ExerciseCatalogEntry } from '@aurboda/api-spec'

import { catalogHint, isSameName } from '../../components/knownValueSuggestions'
import { exerciseNames, type SetRow } from './sessionModel'

export type PickerItem =
  | { kind: 'own'; value: string; count?: number; last_used?: string }
  | { kind: 'catalog'; value: string; key: string; hint?: string }
  | { kind: 'new'; value: string }

export interface PickerSection {
  title?: string
  items: PickerItem[]
}

export const RECENT_SESSIONS = 3

export const recentExercises = (sessions: SetRow[][]): string[] =>
  exerciseNames(sessions.slice(0, RECENT_SESSIONS).flat())

const ownItem = (value: string, known?: ActivityFieldValue): PickerItem => ({
  kind: 'own',
  value,
  ...(known ? { count: known.count, last_used: known.last_used } : {}),
})

const catalogItems = (entries: ExerciseCatalogEntry[], listed: ActivityFieldValue[]): PickerItem[] => {
  const keys = new Set(listed.flatMap((v) => (v.catalog_key ? [v.catalog_key] : [])))
  return entries
    .filter((e) => !keys.has(e.key) && !listed.some((v) => isSameName(v.value, e.name)))
    .map((e) => ({ hint: catalogHint(e), key: e.key, kind: 'catalog', value: e.name }))
}

const withItems = (sections: PickerSection[]): PickerSection[] => sections.filter((s) => s.items.length > 0)

export const buildPickerSections = ({
  catalog,
  own,
  recent,
  text,
}: {
  catalog: ExerciseCatalogEntry[]
  own: ActivityFieldValue[]
  recent: string[]
  text: string
}): PickerSection[] => {
  const typed = text.trim()
  if (typed === '') {
    const rest = own.filter((v) => !recent.some((r) => isSameName(r, v.value)))
    return withItems([
      {
        items: recent.map((r) =>
          ownItem(
            r,
            own.find((v) => isSameName(v.value, r)),
          ),
        ),
        title: 'Recent',
      },
      { items: rest.map((v) => ownItem(v.value, v)), title: 'Your exercises' },
      { items: catalogItems(catalog, own), title: 'From the catalogue' },
    ])
  }
  const needle = typed.toLowerCase()
  const matching = own.filter((v) => v.value.toLowerCase().includes(needle))
  const fromCatalog = catalogItems(catalog, matching)
  const listed = [...matching.map((v) => v.value), ...fromCatalog.map((c) => c.value)]
  const newRow: PickerItem[] = listed.some((name) => isSameName(name, typed))
    ? []
    : [{ kind: 'new', value: typed }]
  return withItems([
    { items: matching.map((v) => ownItem(v.value, v)), title: 'Your exercises' },
    { items: fromCatalog, title: 'From the catalogue' },
    { items: newRow },
  ])
}
