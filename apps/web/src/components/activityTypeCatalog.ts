import type {
  ActivityTypeCatalogEntry,
  ActivityTypeCatalogResult,
  ActivityTypeCatalogVariant,
  DataFieldDefinition,
} from '@aurboda/api-spec'

import type { ActivityTypeDefinition } from '../state/api/types'

import { enumValueLabel } from './sessions/sessionView'

const toSnake = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_|_$/g, '')

const variantsOf = (entry: ActivityTypeCatalogEntry): ActivityTypeCatalogVariant[] => entry.variants ?? []

const labelMatcher = (query: string) => {
  const q = query.trim().toLowerCase()
  const snake = toSnake(q)
  const texts = (l: { aliases: string[]; display_name: string }) =>
    [l.display_name, ...l.aliases].map((t) => t.toLowerCase())
  return {
    isExact: (l: { aliases: string[]; display_name: string; name: string }) =>
      l.name === q || (snake !== '' && l.name === snake) || texts(l).includes(q),
    matches: (l: { aliases: string[]; display_name: string; name: string }) =>
      l.name.includes(q) || (snake !== '' && l.name.includes(snake)) || texts(l).some((t) => t.includes(q)),
    q,
  }
}

/**
 * Entries not in use whose name, display name or an alias contains the query (case-insensitive; the query also
 * compared in snake_case against the name), then those reached through one of their variants. Exact matches
 * first, then file order. Empty query: [].
 */
export const catalogSuggestions = (
  entries: ActivityTypeCatalogEntry[],
  query: string,
  limit = 5,
): ActivityTypeCatalogEntry[] => {
  const { isExact, matches, q } = labelMatcher(query)
  if (!q) return []
  const notInUse = entries.filter((e) => !e.in_use)
  const direct = notInUse.filter(matches)
  const throughVariant = notInUse.filter((e) => !direct.includes(e) && variantsOf(e).some(matches))
  return [
    ...direct.filter(isExact),
    ...direct.filter((e) => !isExact(e)),
    ...throughVariant.filter((e) => variantsOf(e).some(isExact)),
    ...throughVariant.filter((e) => !variantsOf(e).some(isExact)),
  ].slice(0, limit)
}

/**
 * Variants whose name, display name or an alias contains the query, with their entries, in use or not. Exact
 * matches first, then file order. Empty query: [].
 */
export const catalogVariantSuggestions = (
  entries: ActivityTypeCatalogEntry[],
  query: string,
  limit = 3,
): { entry: ActivityTypeCatalogEntry; variant: ActivityTypeCatalogVariant }[] => {
  const { isExact, matches, q } = labelMatcher(query)
  if (!q) return []
  const found = entries.flatMap((entry) =>
    variantsOf(entry)
      .filter(matches)
      .map((variant) => ({ entry, variant })),
  )
  return [...found.filter((f) => isExact(f.variant)), ...found.filter((f) => !isExact(f.variant))].slice(
    0,
    limit,
  )
}

export interface CatalogSuggestionRow {
  entry: ActivityTypeCatalogEntry
  /** The variant the query reached the entry through, when it did not match the entry itself. */
  variant?: ActivityTypeCatalogVariant
}

/**
 * The Add Type form's suggestions: `catalogSuggestions`, then the entries of matching variants not listed yet
 * (in use ones included, which the form shows without a button).
 */
export const catalogSuggestionRows = (
  entries: ActivityTypeCatalogEntry[],
  query: string,
): CatalogSuggestionRow[] => {
  const { matches } = labelMatcher(query)
  const variantMatches = catalogVariantSuggestions(entries, query)
  const variantFor = (entry: ActivityTypeCatalogEntry) =>
    matches(entry) ? undefined : variantMatches.find((m) => m.entry === entry)?.variant
  const rows: CatalogSuggestionRow[] = catalogSuggestions(entries, query).map((entry) => ({
    entry,
    variant: variantFor(entry),
  }))
  for (const { entry, variant } of variantMatches) {
    if (!rows.some((row) => row.entry === entry)) rows.push({ entry, variant })
  }
  return rows
}

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()

export type CatalogRelation =
  | { kind: 'fields'; entry: ActivityTypeCatalogEntry; missing: DataFieldDefinition[] }
  | {
      kind: 'variant'
      entry: ActivityTypeCatalogEntry
      variant: ActivityTypeCatalogVariant
      /** Set when the type is named after one of the variant's Oura tag codes. */
      oura_code?: string
    }
  | {
      kind: 'alias'
      entry: ActivityTypeCatalogEntry
      /** Set when the type is named after one of the entry's Oura tag codes. */
      oura_code?: string
    }

/** How a type the user has relates to the catalogue, if it does. */
export const catalogRelation = (
  def: Pick<ActivityTypeDefinition, 'display_name' | 'is_builtin' | 'name'>,
  entries: ActivityTypeCatalogEntry[],
): CatalogRelation | undefined => {
  const same = entries.find((e) => e.name === def.name)
  if (same) {
    if (same.missing_fields.length === 0) return undefined
    const missing = (same.data_schema?.fields ?? []).filter((f) => same.missing_fields.includes(f.name))
    return { entry: same, kind: 'fields', missing }
  }
  if (def.is_builtin) return undefined

  const own = new Set([normalize(def.name), normalize(def.display_name)])
  const named = (labels: string[]) => labels.some((label) => own.has(normalize(label)))
  for (const entry of entries) {
    const variant = variantsOf(entry).find(
      (v) => v.name === def.name || named([v.name, v.display_name, ...v.aliases]),
    )
    if (variant) return { entry, kind: 'variant', variant }
  }
  const aliased = entries.find((e) => named([e.display_name, ...e.aliases]))
  if (aliased) return { entry: aliased, kind: 'alias' }

  for (const entry of entries) {
    const variant = variantsOf(entry).find((v) => v.oura_codes?.includes(def.name))
    if (variant) return { entry, kind: 'variant', oura_code: def.name, variant }
    if (entry.oura_codes?.includes(def.name)) return { entry, kind: 'alias', oura_code: def.name }
  }
  return undefined
}

/** "kind beer" for a variant's data: each field's label or name, then its value as words, joined by ", ". */
export const variantDataSummary = (
  entry: ActivityTypeCatalogEntry,
  variant: ActivityTypeCatalogVariant,
): string =>
  Object.entries(variant.data)
    .map(([key, value]) => {
      const field = entry.data_schema?.fields.find((f) => f.name === key)
      const label = (field?.label ?? key).toLowerCase().replaceAll('_', ' ')
      return `${label} ${enumValueLabel(String(value))}`
    })
    .join(', ')

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
