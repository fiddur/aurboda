import type {
  ActivityTypeCatalogEntry,
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

interface CatalogIndex {
  byLabel: Map<string, StoredActivityTypeCatalogEntry>
  byName: Map<string, StoredActivityTypeCatalogEntry>
  words: Map<StoredActivityTypeCatalogEntry, string[]>
}

const indexes = new WeakMap<StoredActivityTypeCatalog, CatalogIndex>()

const wordsOf = (text: string): string[] => normalizeCatalogText(text).split(' ').filter(Boolean)

const labelsOf = (entry: StoredActivityTypeCatalogEntry): string[] => [
  entry.name,
  entry.display_name,
  ...entry.aliases,
]

const indexOf = (catalog: StoredActivityTypeCatalog): CatalogIndex => {
  const cached = indexes.get(catalog)
  if (cached) return cached
  const index: CatalogIndex = { byLabel: new Map(), byName: new Map(), words: new Map() }
  for (const entry of catalog.entries) {
    index.byName.set(entry.name, entry)
    for (const label of labelsOf(entry)) {
      const key = normalizeCatalogText(label)
      if (!index.byLabel.has(key)) index.byLabel.set(key, entry)
    }
    index.words.set(entry, [...new Set(labelsOf(entry).flatMap(wordsOf))])
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

/** Every word of `q` is a prefix of a word of the name, display name or an alias. File order is kept. */
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
): ActivityTypeCatalogEntry => ({ ...entry, in_use: inUse })
