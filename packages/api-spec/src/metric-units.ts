import type { StoredMetricCatalogEntry } from './schemas/metric-catalog.ts'

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

/** Every spelling of every unit the entry accepts, the stored unit first. */
export const allCatalogUnitSpellings = (
  entry: Pick<StoredMetricCatalogEntry, 'unit' | 'unit_aliases' | 'units'>,
): string[] => [
  entry.unit,
  ...(entry.unit_aliases ?? []),
  ...entry.units.flatMap((unit) => [unit.unit, ...(unit.aliases ?? [])]),
]

export const catalogAcceptsUnit = (
  entry: Pick<StoredMetricCatalogEntry, 'unit' | 'unit_aliases' | 'units'>,
  unit: string,
): boolean => allCatalogUnitSpellings(entry).some((spelling) => sameUnit(spelling, unit))
