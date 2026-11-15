/**
 * Open Food Facts (OFF) lookup by barcode.
 *
 * API: https://openfoodfacts.github.io/openfoodfacts-server/api/
 * Licence: ODbL — attribution required when serving the data back to users.
 *
 * One product per request, fetched on demand when a user looks up a barcode,
 * stored in the central shared library as `source = 'openfoodfacts'`,
 * `source_id = <normalised barcode>` and reused for everyone for 90 days.
 */

import { BARCODE_PATTERN, stripBarcodeSeparators } from '@aurboda/api-spec'
import { isAxiosError } from 'axios'
import { z } from 'zod'

import type {
  InsertSharedFoodItemInput,
  SharedFoodItemEntity,
  SharedFoodItemsApi,
} from '../central-food-items.ts'

import { appVersion } from '../app-version.ts'
import { safeFetchGet } from '../safe-fetch.ts'

export const OFF_SOURCE = 'openfoodfacts'
export const OFF_DEFAULT_BASE_URL = 'https://world.openfoodfacts.org'
export const OFF_REFRESH_AFTER_MS = 90 * 24 * 60 * 60 * 1000
const OFF_TIMEOUT_MS = 10_000
const OFF_MAX_CONCURRENT_FETCHES = 4
const MAX_NAME_LENGTH = 255

/**
 * The digits OFF itself would look the product up under: leading zeros
 * dropped, then padded back to EAN-8 or EAN-13 length. A UPC-A
 * (`049000028911`) and its EAN-13 form (`0049000028911`) land on the same
 * row; a GTIN-14 with a significant first digit stays 14 long.
 */
export const normalizeBarcode = (raw: string): string | null => {
  const digits = stripBarcodeSeparators(raw)
  if (!BARCODE_PATTERN.test(digits)) return null
  const significant = digits.replace(/^0+/, '')
  if (significant.length <= 8) return significant.padStart(8, '0')
  if (significant.length <= 13) return significant.padStart(13, '0')
  return significant
}

const numberish = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(v)
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: 'custom', message: 'not a number' })
    return z.NEVER
  }
  return n
})

export const offProductSchema = z.object({
  brands: z.string().optional().catch(undefined),
  nutriments: z.record(z.string(), z.unknown()).optional().catch(undefined),
  nutrition_data_per: z.string().optional().catch(undefined),
  product_name: z.string().optional().catch(undefined),
  serving_quantity: numberish.optional().catch(undefined),
  serving_quantity_unit: z.string().optional().catch(undefined),
})

export type OffProduct = z.infer<typeof offProductSchema>

const offResponseSchema = z.object({
  product: offProductSchema.optional(),
  result: z.object({ id: z.string() }).partial().optional(),
  status: z.string().optional(),
})

export const OFF_FIELDS = [
  'product_name',
  'brands',
  'serving_quantity',
  'serving_quantity_unit',
  'nutrition_data_per',
  'nutriments',
]

/** OFF nutriment key → our column, and the factor from OFF's per-100 g unit (grams) to the column's unit. */
const G = 1
const MG = 1000
const UG = 1_000_000
const OFF_NUTRIENTS: [string, string, number][] = [
  ['proteins', 'protein', G],
  ['carbohydrates', 'carbs', G],
  ['fat', 'fat', G],
  ['fiber', 'fiber', G],
  ['sugars', 'sugars', G],
  ['added-sugars', 'added_sugars', G],
  ['starch', 'starch', G],
  ['sucrose', 'sucrose', G],
  ['saturated-fat', 'saturated_fat', G],
  ['monounsaturated-fat', 'monounsaturated_fat', G],
  ['polyunsaturated-fat', 'polyunsaturated_fat', G],
  ['trans-fat', 'trans_fat', G],
  ['omega-3-fat', 'omega_3', G],
  ['omega-6-fat', 'omega_6', G],
  ['alpha-linolenic-acid', 'ala', G],
  ['docosahexaenoic-acid', 'dha', G],
  ['eicosapentaenoic-acid', 'epa', G],
  ['linoleic-acid', 'la', G],
  ['arachidonic-acid', 'aa', G],
  ['lauric-acid', 'lauric_acid', G],
  ['myristic-acid', 'myristic_acid', G],
  ['palmitic-acid', 'palmitic_acid', G],
  ['stearic-acid', 'stearic_acid', G],
  ['oleic-acid', 'oleic_acid', G],
  ['arachidic-acid', 'arachidic_acid', G],
  ['cholesterol', 'cholesterol', MG],
  ['caffeine', 'caffeine', MG],
  ['salt', 'salt', G],
  ['sodium', 'sodium', MG],
  ['vitamin-a', 'vitamin_a', UG],
  ['beta-carotene', 'beta_carotene', UG],
  ['vitamin-c', 'vitamin_c', MG],
  ['vitamin-d', 'vitamin_d', UG],
  ['vitamin-e', 'vitamin_e', MG],
  ['vitamin-k', 'vitamin_k', UG],
  ['vitamin-b1', 'b1_thiamine', MG],
  ['vitamin-b2', 'b2_riboflavin', MG],
  ['vitamin-pp', 'b3_niacin', MG],
  ['pantothenic-acid', 'b5_pantothenic_acid', MG],
  ['vitamin-b6', 'b6_pyridoxine', MG],
  ['vitamin-b12', 'b12_cobalamin', UG],
  ['vitamin-b9', 'folate', UG],
  ['folates', 'folate', UG],
  ['calcium', 'calcium', MG],
  ['chromium', 'chromium', UG],
  ['copper', 'copper', MG],
  ['iron', 'iron', MG],
  ['magnesium', 'magnesium', MG],
  ['manganese', 'manganese', MG],
  ['phosphorus', 'phosphorus', MG],
  ['potassium', 'potassium', MG],
  ['selenium', 'selenium', UG],
  ['zinc', 'zinc', MG],
  ['iodine', 'iodine', UG],
]

const KJ_PER_KCAL = 4.184
const SALT_PER_SODIUM = 2.5
const REQUIRED_COLUMNS = ['calories', 'protein', 'carbs', 'fat']

/** Rounds away float noise from unit scaling (0.0021 g × 1000 = 2.0999999999999996 mg). */
const clean = (n: number): number => Number.parseFloat(n.toPrecision(10))

export interface OffMapping {
  name: string
  default_quantity: number
  default_unit: 'g' | 'ml'
  default_log_quantity?: number
  nutrient_data_incomplete: boolean
  columns: Record<string, number>
}

const nutrimentReader = (nutriments: Record<string, unknown>, basis: 'g' | 'ml') => {
  const suffixes = basis === 'ml' ? ['_100ml', '_100g'] : ['_100g']
  return (key: string): number | undefined => {
    for (const suffix of suffixes) {
      const parsed = numberish.safeParse(nutriments[`${key}${suffix}`])
      if (parsed.success && parsed.data >= 0) return parsed.data
    }
    return undefined
  }
}

const productName = (product: OffProduct, barcode: string): string => {
  const name = product.product_name?.trim()
  const brand = product.brands
    ?.split(',')
    .map((b) => b.trim())
    .find((b) => b.length > 0)
  const base = name || brand || `Product ${barcode}`
  const full =
    brand && name && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} (${brand})` : base
  return full.slice(0, MAX_NAME_LENGTH)
}

const energyKcal = (read: (key: string) => number | undefined): number | undefined => {
  const kcal = read('energy-kcal')
  if (kcal !== undefined) return clean(kcal)
  const kj = read('energy-kj') ?? read('energy')
  return kj === undefined ? undefined : clean(kj / KJ_PER_KCAL)
}

const withSaltAndSodium = (columns: Record<string, number>): Record<string, number> => {
  if (columns.sodium === undefined && columns.salt !== undefined) {
    return { ...columns, sodium: clean((columns.salt / SALT_PER_SODIUM) * MG) }
  }
  if (columns.salt === undefined && columns.sodium !== undefined) {
    return { ...columns, salt: clean((columns.sodium / MG) * SALT_PER_SODIUM) }
  }
  return columns
}

const servingInBasis = (product: OffProduct, basis: 'g' | 'ml'): number | undefined => {
  const unit = product.serving_quantity_unit?.trim().toLowerCase() || 'g'
  const serving = product.serving_quantity
  return serving !== undefined && serving > 0 && unit === basis ? serving : undefined
}

export const mapOffProductToColumns = (product: OffProduct, barcode: string): OffMapping => {
  const basis: 'g' | 'ml' = product.nutrition_data_per?.trim().toLowerCase() === '100ml' ? 'ml' : 'g'
  const read = nutrimentReader(product.nutriments ?? {}, basis)
  const mapped: Record<string, number> = {}
  const calories = energyKcal(read)
  if (calories !== undefined) mapped.calories = calories
  for (const [key, column, factor] of OFF_NUTRIENTS) {
    if (mapped[column] !== undefined) continue
    const value = read(key)
    if (value !== undefined) mapped[column] = clean(value * factor)
  }
  const columns = withSaltAndSodium(mapped)

  return {
    columns,
    default_log_quantity: servingInBasis(product, basis),
    default_quantity: 100,
    default_unit: basis,
    name: productName(product, barcode),
    nutrient_data_incomplete: REQUIRED_COLUMNS.some((c) => columns[c] === undefined),
  }
}

export const buildOffSharedFoodItemInput = (
  product: OffProduct,
  barcode: string,
  fetchedAt: Date,
): InsertSharedFoodItemInput => {
  const mapped = mapOffProductToColumns(product, barcode)
  return {
    ...mapped.columns,
    default_log_quantity: mapped.default_log_quantity,
    default_quantity: mapped.default_quantity,
    default_unit: mapped.default_unit,
    last_fetched_at: fetchedAt,
    name: mapped.name,
    nutrient_data_incomplete: mapped.nutrient_data_incomplete,
    source: OFF_SOURCE,
    source_id: barcode,
  }
}

export type OffFetchResult = { kind: 'found'; product: OffProduct } | { kind: 'not_found' }

export interface OffFetchDeps {
  get?: typeof safeFetchGet
  baseUrl?: string
  userAgent?: string
}

export const offUserAgent = (): string => `Aurboda/${appVersion()} (https://github.com/fiddur/aurboda)`

/** Resolves `not_found` for a barcode OFF does not know; throws when OFF cannot be asked or answers garbage. */
export const fetchOffProduct = async (barcode: string, deps: OffFetchDeps = {}): Promise<OffFetchResult> => {
  const get = deps.get ?? safeFetchGet
  const url = `${deps.baseUrl ?? OFF_DEFAULT_BASE_URL}/api/v3/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS.join(',')}`
  let body: unknown
  try {
    const res = await get(url, {
      headers: { Accept: 'application/json', 'User-Agent': deps.userAgent ?? offUserAgent() },
      timeout: OFF_TIMEOUT_MS,
    })
    body = res.data
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) return { kind: 'not_found' }
    throw err
  }
  const parsed = offResponseSchema.safeParse(body)
  if (!parsed.success) throw new Error('Open Food Facts answered with an unexpected shape')
  if (parsed.data.result?.id === 'product_not_found') return { kind: 'not_found' }
  if (!parsed.data.product) throw new Error('Open Food Facts answered without a product')
  return { kind: 'found', product: parsed.data.product }
}

/**
 * Per-process cap on concurrent OFF requests, with concurrent lookups of the
 * same barcode sharing one request. Every unknown barcode costs an outbound
 * call, so a burst of lookups waits on OFF at most `max` at a time.
 */
export const createOffFetchGuard = (max = OFF_MAX_CONCURRENT_FETCHES) => {
  const inFlight = new Map<string, Promise<OffFetchResult>>()
  return async (
    barcode: string,
    fetch: () => Promise<OffFetchResult>,
  ): Promise<OffFetchResult | { kind: 'busy' }> => {
    const existing = inFlight.get(barcode)
    if (existing) return existing
    if (inFlight.size >= max) return { kind: 'busy' }
    const pending = fetch().finally(() => inFlight.delete(barcode))
    inFlight.set(barcode, pending)
    return pending
  }
}

export type OffFetchGuard = ReturnType<typeof createOffFetchGuard>

const defaultGuard = createOffFetchGuard()

export type BarcodeLookupResult =
  | { kind: 'found'; item: SharedFoodItemEntity }
  | { kind: 'invalid_barcode' }
  | { kind: 'not_found' }
  | { kind: 'upstream_error' }
  | { kind: 'busy' }

export interface BarcodeLookupDeps {
  store: Pick<SharedFoodItemsApi, 'getSharedFoodItemsBySourceIds' | 'upsertSharedFoodItem'>
  fetchProduct?: (barcode: string) => Promise<OffFetchResult>
  guard?: OffFetchGuard
  now?: () => Date
  warn?: (message: string) => void
}

const isFresh = (item: SharedFoodItemEntity, now: Date): boolean =>
  item.last_fetched_at !== undefined && now.getTime() - item.last_fetched_at.getTime() < OFF_REFRESH_AFTER_MS

export const lookupFoodByBarcode = async (
  rawBarcode: string,
  deps: BarcodeLookupDeps,
): Promise<BarcodeLookupResult> => {
  const barcode = normalizeBarcode(rawBarcode)
  if (!barcode) return { kind: 'invalid_barcode' }
  const now = (deps.now ?? (() => new Date()))()
  const [cached] = await deps.store.getSharedFoodItemsBySourceIds([
    { source: OFF_SOURCE, source_id: barcode },
  ])
  if (cached && isFresh(cached, now)) return { item: cached, kind: 'found' }

  const fetchProduct = deps.fetchProduct ?? ((code: string) => fetchOffProduct(code))
  const guard = deps.guard ?? defaultGuard
  const warn = deps.warn ?? console.warn
  let result: OffFetchResult | { kind: 'busy' }
  try {
    result = await guard(barcode, () => fetchProduct(barcode))
  } catch (err) {
    warn(`[openfoodfacts] lookup of ${barcode} failed: ${err instanceof Error ? err.message : String(err)}`)
    return cached ? { item: cached, kind: 'found' } : { kind: 'upstream_error' }
  }
  if (result.kind === 'busy') return cached ? { item: cached, kind: 'found' } : { kind: 'busy' }
  if (result.kind === 'not_found') return cached ? { item: cached, kind: 'found' } : { kind: 'not_found' }
  const item = await deps.store.upsertSharedFoodItem(
    buildOffSharedFoodItemInput(result.product, barcode, now),
  )
  return { item, kind: 'found' }
}

export const BARCODE_NOT_FOUND_ERROR = 'No product with this barcode at Open Food Facts'

export const barcodeLookupFailure = (
  kind: Exclude<BarcodeLookupResult['kind'], 'found'>,
): { status: number; error: string } => {
  switch (kind) {
    case 'invalid_barcode':
      return { error: 'A barcode is 8 to 14 digits (EAN-8, UPC-A, EAN-13 or GTIN-14)', status: 400 }
    case 'not_found':
      return { error: BARCODE_NOT_FOUND_ERROR, status: 404 }
    case 'busy':
      return { error: 'Too many barcode lookups at once. Try again in a moment.', status: 503 }
    case 'upstream_error':
      return { error: 'Open Food Facts could not be reached. Try again in a moment.', status: 502 }
  }
}
