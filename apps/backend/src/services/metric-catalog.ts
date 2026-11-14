import type {
  CustomMetricDefinition,
  MetricCatalogEntry,
  StoredMetricCatalog,
  StoredMetricCatalogEntry,
} from '@aurboda/api-spec'

import { readFileSync } from 'node:fs'

import { normalizeCatalogText } from './activity-type-catalog.ts'

let loaded: StoredMetricCatalog | undefined

/** The built-in catalogue, read once on first use. Its shape is checked by the catalogue tests, not here. */
export const loadMetricCatalog = (): StoredMetricCatalog => {
  loaded ??= JSON.parse(
    readFileSync(new URL('../catalog/metrics/metric-catalog.json', import.meta.url), 'utf8'),
  ) as StoredMetricCatalog
  return loaded
}

interface CatalogIndex {
  byLabel: Map<string, StoredMetricCatalogEntry>
  byName: Map<string, StoredMetricCatalogEntry>
  words: Map<StoredMetricCatalogEntry, string[]>
}

const indexes = new WeakMap<StoredMetricCatalog, CatalogIndex>()

const wordsOf = (text: string): string[] => normalizeCatalogText(text).split(' ').filter(Boolean)

const labelsOf = (entry: StoredMetricCatalogEntry): string[] => [
  entry.name,
  entry.display_name,
  ...entry.aliases,
]

const indexOf = (catalog: StoredMetricCatalog): CatalogIndex => {
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

export const getCatalogMetric = (
  catalog: StoredMetricCatalog,
  name: string,
): StoredMetricCatalogEntry | undefined => indexOf(catalog).byName.get(name)

/** By name, display name or alias, ignoring case and punctuation. */
export const findCatalogMetric = (
  catalog: StoredMetricCatalog,
  text: string,
): StoredMetricCatalogEntry | undefined => indexOf(catalog).byLabel.get(normalizeCatalogText(text))

/**
 * For comparing units only; a stored unit keeps its own spelling. NFKC is not used: it turns the micro sign
 * into Greek mu and `10⁹` into `109`.
 */
export const normalizeUnit = (unit: string): string =>
  unit
    .trim()
    .replaceAll('μ', 'µ')
    .toLowerCase()
    .replaceAll(/\s+/g, '')
    .replaceAll('mcg', 'µg')
    .replaceAll(/(^|[^a-z])u(?=g|mol|iu|kat|l)/g, '$1µ')
    .replaceAll('percent', '%')
    .replaceAll('celsius', '°c')

export const sameUnit = (a: string, b: string): boolean => normalizeUnit(a) === normalizeUnit(b)

interface UnitConversion {
  factor: number
  offset: number
}

const STORED: UnitConversion = { factor: 1, offset: 0 }

const unitIndexes = new WeakMap<StoredMetricCatalogEntry, Map<string, UnitConversion>>()

const unitIndexOf = (entry: StoredMetricCatalogEntry): Map<string, UnitConversion> => {
  const cached = unitIndexes.get(entry)
  if (cached) return cached
  const index = new Map<string, UnitConversion>()
  for (const spelling of [entry.unit, ...(entry.unit_aliases ?? [])]) {
    index.set(normalizeUnit(spelling), STORED)
  }
  for (const unit of entry.units) {
    const conversion = { factor: unit.factor, offset: unit.offset ?? 0 }
    for (const spelling of [unit.unit, ...(unit.aliases ?? [])]) {
      const key = normalizeUnit(spelling)
      if (!index.has(key)) index.set(key, conversion)
    }
  }
  unitIndexes.set(entry, index)
  return index
}

export const isCatalogUnit = (entry: StoredMetricCatalogEntry, unit: string): boolean =>
  unitIndexOf(entry).has(normalizeUnit(unit))

/** Every accepted unit in its canonical spelling, the stored unit first. */
export const catalogUnitSpellings = (entry: StoredMetricCatalogEntry): string[] => [
  entry.unit,
  ...entry.units.map((unit) => unit.unit),
]

const roundConverted = (value: number): number => Number(value.toPrecision(6))

/** `value` in `from` expressed in `to`, through the stored unit; undefined when either unit is not the entry's. */
export const convertCatalogValue = (
  entry: StoredMetricCatalogEntry,
  value: number,
  from: string,
  to: string,
): number | undefined => {
  const index = unitIndexOf(entry)
  const source = index.get(normalizeUnit(from))
  const target = index.get(normalizeUnit(to))
  if (!source || !target) return undefined
  if (source.factor === target.factor && source.offset === target.offset) return value
  const stored = (value + source.offset) * source.factor
  return roundConverted(stored / target.factor - target.offset)
}

/** Every word of `q` is a prefix of a word of the name, display name or an alias. File order is kept. */
export const searchMetricCatalog = (
  catalog: StoredMetricCatalog,
  q: string | undefined,
): StoredMetricCatalogEntry[] => {
  const queryWords = wordsOf(q ?? '')
  if (queryWords.length === 0) return catalog.entries
  const index = indexOf(catalog)
  return catalog.entries.filter((entry) => {
    const entryWords = index.words.get(entry) ?? []
    return queryWords.every((word) => entryWords.some((entryWord) => entryWord.startsWith(word)))
  })
}

export const toMetricCatalogEntry = (
  entry: StoredMetricCatalogEntry,
  userMetric: CustomMetricDefinition | undefined,
): MetricCatalogEntry => ({
  ...entry,
  in_use: userMetric !== undefined,
  ...(userMetric ? { in_use_unit: userMetric.unit } : {}),
})

/** The custom metric a catalogue metric becomes when it is first used. */
export const catalogMetricDefinition = (entry: StoredMetricCatalogEntry): CustomMetricDefinition => ({
  aggregation: 'avg',
  description: entry.display_name,
  include_in_daily_summary: false,
  name: entry.name,
  unit: entry.unit,
})
