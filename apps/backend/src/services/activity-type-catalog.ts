import type {
  ActivityTypeCatalogEntry,
  ActivityTypeCatalogVariant,
  DataFieldDefinition,
  DataSchemaDefinition,
  StoredActivityTypeCatalog,
  StoredActivityTypeCatalogEntry,
} from '@aurboda/api-spec'

import { readFileSync } from 'node:fs'

export const normalizeCatalogText = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()

let loaded: StoredActivityTypeCatalog | undefined

/** The built-in catalogue, read once on first use. Its shape is checked by the catalogue tests, not here. */
export const loadActivityTypeCatalog = (): StoredActivityTypeCatalog => {
  loaded ??= JSON.parse(
    readFileSync(new URL('../catalog/activity-types/activity-type-catalog.json', import.meta.url), 'utf8'),
  ) as StoredActivityTypeCatalog
  return loaded
}

export interface CatalogVariantMatch {
  entry: StoredActivityTypeCatalogEntry
  variant: ActivityTypeCatalogVariant
}

interface CatalogIndex {
  byLabel: Map<string, StoredActivityTypeCatalogEntry>
  byName: Map<string, StoredActivityTypeCatalogEntry>
  variantByLabel: Map<string, CatalogVariantMatch>
  words: Map<StoredActivityTypeCatalogEntry, string[]>
}

const indexes = new WeakMap<StoredActivityTypeCatalog, CatalogIndex>()

const wordsOf = (text: string): string[] => normalizeCatalogText(text).split(' ').filter(Boolean)

const labelsOf = (
  entry: Pick<StoredActivityTypeCatalogEntry, 'aliases' | 'display_name' | 'name'>,
): string[] => [entry.name, entry.display_name, ...entry.aliases]

const variantsOf = (entry: StoredActivityTypeCatalogEntry): ActivityTypeCatalogVariant[] =>
  entry.variants ?? []

const indexOf = (catalog: StoredActivityTypeCatalog): CatalogIndex => {
  const cached = indexes.get(catalog)
  if (cached) return cached
  const index: CatalogIndex = {
    byLabel: new Map(),
    byName: new Map(),
    variantByLabel: new Map(),
    words: new Map(),
  }
  for (const entry of catalog.entries) {
    index.byName.set(entry.name, entry)
    for (const label of labelsOf(entry)) {
      const key = normalizeCatalogText(label)
      if (!index.byLabel.has(key)) index.byLabel.set(key, entry)
    }
    for (const variant of variantsOf(entry)) {
      for (const label of labelsOf(variant)) {
        const key = normalizeCatalogText(label)
        if (!index.variantByLabel.has(key)) index.variantByLabel.set(key, { entry, variant })
      }
    }
    const labels = [...labelsOf(entry), ...variantsOf(entry).flatMap(labelsOf)]
    index.words.set(entry, [...new Set(labels.flatMap(wordsOf))])
  }
  indexes.set(catalog, index)
  return index
}

export const getCatalogActivityType = (
  catalog: StoredActivityTypeCatalog,
  name: string,
): StoredActivityTypeCatalogEntry | undefined => indexOf(catalog).byName.get(name)

/** By name, display name or alias, ignoring case and punctuation. */
export const findCatalogActivityType = (
  catalog: StoredActivityTypeCatalog,
  text: string,
): StoredActivityTypeCatalogEntry | undefined => indexOf(catalog).byLabel.get(normalizeCatalogText(text))

/** A variant by its name, display name or alias, ignoring case and punctuation. */
export const findCatalogVariant = (
  catalog: StoredActivityTypeCatalog,
  text: string,
): CatalogVariantMatch | undefined => indexOf(catalog).variantByLabel.get(normalizeCatalogText(text))

/** The catalogue fields of `entry` that `schema` has no field of the same name for. */
export const missingCatalogFields = (
  entry: StoredActivityTypeCatalogEntry,
  schema: DataSchemaDefinition | null | undefined,
): DataFieldDefinition[] => {
  const have = new Set((schema?.fields ?? []).map((field) => field.name))
  return (entry.data_schema?.fields ?? []).filter((field) => !have.has(field.name))
}

const describeVariantData = (data: ActivityTypeCatalogVariant['data']): string =>
  Object.entries(data)
    .map(([key, value]) => `${key} "${String(value)}"`)
    .join(', ')

/**
 * `"beer" is the built-in type "alcohol" with kind "beer": use activity_type "alcohol" with data {"kind":"beer"}`;
 * undefined for a name that is no variant.
 */
export const catalogVariantHint = (catalog: StoredActivityTypeCatalog, name: string): string | undefined => {
  const match = findCatalogVariant(catalog, name)
  if (!match) return undefined
  const { entry, variant } = match
  return `"${name}" is the built-in type "${entry.name}" with ${describeVariantData(variant.data)}: use activity_type "${entry.name}" with data ${JSON.stringify(variant.data)}`
}

/**
 * The entry's catalogue ancestors first, then the entry; empty for an unknown name. A parent that is not a
 * catalogue entry ends the chain without being part of it.
 */
export const catalogAdoptionChain = (
  catalog: StoredActivityTypeCatalog,
  name: string,
): StoredActivityTypeCatalogEntry[] => {
  const chain: StoredActivityTypeCatalogEntry[] = []
  let entry = getCatalogActivityType(catalog, name)
  while (entry && !chain.includes(entry)) {
    chain.unshift(entry)
    entry = entry.parent_type === undefined ? undefined : getCatalogActivityType(catalog, entry.parent_type)
  }
  return chain
}

/**
 * Every word of `q` is a prefix of a word of the name, display name or an alias of the entry or of one of its
 * variants. File order is kept.
 */
export const searchActivityTypeCatalog = (
  catalog: StoredActivityTypeCatalog,
  q: string | undefined,
): StoredActivityTypeCatalogEntry[] => {
  const queryWords = wordsOf(q ?? '')
  if (queryWords.length === 0) return catalog.entries
  const index = indexOf(catalog)
  return catalog.entries.filter((entry) => {
    const entryWords = index.words.get(entry) ?? []
    return queryWords.every((word) => entryWords.some((entryWord) => entryWord.startsWith(word)))
  })
}

export const toActivityTypeCatalogEntry = (
  entry: StoredActivityTypeCatalogEntry,
  inUse: boolean,
  missingFields: string[],
): ActivityTypeCatalogEntry => ({ ...entry, in_use: inUse, missing_fields: missingFields })
