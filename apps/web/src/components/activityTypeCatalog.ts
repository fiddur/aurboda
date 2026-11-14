import type { ActivityTypeCatalogEntry, ActivityTypeCatalogResult } from '@aurboda/api-spec'

import type { ActivityTypeDefinition } from '../state/api/types'

const toSnake = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_|_$/g, '')

/** Entries not in use whose name, display name or an alias contains the query (case-insensitive; the query also compared in snake_case against the name). Exact matches first, then file order. Empty query: []. */
export const catalogSuggestions = (
  entries: ActivityTypeCatalogEntry[],
  query: string,
  limit = 5,
): ActivityTypeCatalogEntry[] => {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const snake = toSnake(q)
  const texts = (e: ActivityTypeCatalogEntry) => [e.display_name, ...e.aliases].map((t) => t.toLowerCase())
  const isExact = (e: ActivityTypeCatalogEntry) =>
    e.name === q || (snake !== '' && e.name === snake) || texts(e).includes(q)
  const matches = (e: ActivityTypeCatalogEntry) =>
    e.name.includes(q) || (snake !== '' && e.name.includes(snake)) || texts(e).some((t) => t.includes(q))
  const candidates = entries.filter((e) => !e.in_use && matches(e))
  return [...candidates.filter(isExact), ...candidates.filter((e) => !isExact(e))].slice(0, limit)
}

/** A catalogue entry shaped as a type definition, for pickers and forms that work on definitions. */
export const catalogEntryAsDefinition = (entry: ActivityTypeCatalogEntry): ActivityTypeDefinition => ({
  color: entry.color,
  display_category: entry.display_category,
  display_name: entry.display_name,
  icon: entry.icon,
  is_builtin: false,
  name: entry.name,
  show_on_timeline: true,
  ...(entry.data_schema ? { data_schema: entry.data_schema } : {}),
  ...(entry.parent_type ? { parent_type: entry.parent_type } : {}),
})

/** The user's definition of that name, else the catalogue entry of that name shaped as one. */
export const definitionOrCatalogEntry = (
  name: string,
  defs: ActivityTypeDefinition[],
  entries: ActivityTypeCatalogEntry[],
): ActivityTypeDefinition | undefined => {
  const def = defs.find((d) => d.name === name)
  if (def) return def
  const entry = entries.find((e) => e.name === name)
  return entry ? catalogEntryAsDefinition(entry) : undefined
}

/** The user's definitions followed by the catalogue entries not in use (and not already among the definitions by name). */
export const withCatalogTypes = (
  defs: ActivityTypeDefinition[],
  entries: ActivityTypeCatalogEntry[],
): { def: ActivityTypeDefinition; fromCatalog: boolean }[] => {
  const names = new Set(defs.map((d) => d.name))
  return [
    ...defs.map((def) => ({ def, fromCatalog: false })),
    ...entries
      .filter((e) => !e.in_use && !names.has(e.name))
      .map((e) => ({ def: catalogEntryAsDefinition(e), fromCatalog: true })),
  ]
}

/** Groups in the catalogue's order, each with its entries in file order; a group without entries is left out. */
export const groupCatalogEntries = (
  result: ActivityTypeCatalogResult,
  query: string,
): { key: string; name: string; entries: ActivityTypeCatalogEntry[] }[] => {
  const q = query.trim().toLowerCase()
  const matching = q
    ? result.entries.filter(
        (e) => e.name.toLowerCase().includes(q) || e.display_name.toLowerCase().includes(q),
      )
    : result.entries
  return result.groups
    .map((group) => ({ ...group, entries: matching.filter((e) => e.group === group.key) }))
    .filter((group) => group.entries.length > 0)
}

/** "temperature, dose unit" for an entry's fields, by field name; '' without a schema. */
export const catalogFieldSummary = (entry: ActivityTypeCatalogEntry): string =>
  (entry.data_schema?.fields ?? []).map((f) => f.name.replaceAll('_', ' ')).join(', ')
