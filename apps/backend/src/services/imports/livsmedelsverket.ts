/**
 * Livsmedelsverket (Swedish Food Agency) bulk import.
 *
 * API: https://dataportal.livsmedelsverket.se/livsmedel
 * License: CC BY 4.0 — attribution required when serving the data back to users.
 *
 * Strategy: page through `/api/v1/livsmedel`, then for each food fetch
 * `/api/v1/livsmedel/{nummer}/naringsvarden` and upsert into food_items
 * with source='livsmedelsverket'. Per-100 g basis (every nutrient row reports
 * `viktGram: 100`), so we set default_quantity=100, default_unit='g'.
 */

import type { InsertSharedFoodItemInput, SharedFoodItemsApi } from '../central-food-items.ts'

const DEFAULT_BASE_URL = 'https://dataportal.livsmedelsverket.se/livsmedel'
const PAGE_SIZE = 200

export interface LsvFood {
  nummer: number
  namn: string
}

export interface LsvNutrient {
  euroFIRkod: string
  varde: number
  enhet: string
  viktGram: number
}

interface LsvListResponse {
  _meta: { totalRecords: number; offset: number; limit: number; count: number }
  livsmedel: LsvFood[]
}

/**
 * Map from EuroFIR code (with optional unit qualifier) to our column name.
 *
 * Codes flagged with a comment "may not be present in LSV" stay in the map
 * for forward-compat — if SLV ever ships them, we'll start ingesting.
 *
 * `ENERC` appears twice per food (kJ + kcal); we pick the kcal row only.
 */
const EUROFIR_TO_COLUMN: Record<string, string> = {
  // Macros
  PROT: 'protein',
  CHO: 'carbs',
  FAT: 'fat',
  FIBT: 'fiber',
  ALC: 'alcohol',
  WATER: 'water',
  ASH: 'ash',
  NACL: 'salt',
  SUGAR: 'sugars',
  SUGAD: 'added_sugars',

  // Fat breakdown
  FASAT: 'saturated_fat',
  FAMS: 'monounsaturated_fat',
  FAPU: 'polyunsaturated_fat',
  CHORL: 'cholesterol',
  'F18:3': 'ala',
  'F18:2': 'la',
  'F22:6': 'dha',
  'F22:5': 'dpa',
  'F20:5': 'epa',
  'F20:4': 'aa',

  // Vitamins
  VITA: 'vitamin_a',
  RETOL: 'retinol',
  CARTBTOT: 'beta_carotene',
  VITC: 'vitamin_c',
  VITD: 'vitamin_d',
  VITE: 'vitamin_e',
  VITK: 'vitamin_k',
  THIA: 'b1_thiamine',
  RIBF: 'b2_riboflavin',
  NIA: 'b3_niacin',
  PANTAC: 'b5_pantothenic_acid',
  VITB6: 'b6_pyridoxine',
  VITB12: 'b12_cobalamin',
  FOLFD: 'folate',

  // Minerals
  CA: 'calcium',
  CU: 'copper',
  FE: 'iron',
  MG: 'magnesium',
  MN: 'manganese',
  P: 'phosphorus',
  K: 'potassium',
  SE: 'selenium',
  NA: 'sodium',
  ZN: 'zinc',
  ID: 'iodine',
}

/** Unit conversions to whatever unit our column expects. */
const COLUMN_UNITS: Record<string, 'g' | 'mg' | 'µg' | 'kcal'> = {
  calories: 'kcal',
  protein: 'g',
  carbs: 'g',
  fat: 'g',
  fiber: 'g',
  alcohol: 'g',
  water: 'g',
  ash: 'g',
  salt: 'g',
  sugars: 'g',
  added_sugars: 'g',
  saturated_fat: 'g',
  monounsaturated_fat: 'g',
  polyunsaturated_fat: 'g',
  ala: 'g',
  la: 'g',
  dha: 'g',
  dpa: 'g',
  epa: 'g',
  aa: 'g',
  cholesterol: 'mg',
  vitamin_a: 'µg',
  retinol: 'µg',
  beta_carotene: 'µg',
  vitamin_c: 'mg',
  vitamin_d: 'µg',
  vitamin_e: 'mg',
  vitamin_k: 'µg',
  b1_thiamine: 'mg',
  b2_riboflavin: 'mg',
  b3_niacin: 'mg',
  b5_pantothenic_acid: 'mg',
  b6_pyridoxine: 'mg',
  b12_cobalamin: 'µg',
  folate: 'µg',
  calcium: 'mg',
  copper: 'mg',
  iron: 'mg',
  magnesium: 'mg',
  manganese: 'mg',
  phosphorus: 'mg',
  potassium: 'mg',
  selenium: 'µg',
  sodium: 'mg',
  zinc: 'mg',
  iodine: 'µg',
}

/** µ written as either "µ" (U+00B5) or "μ" (U+03BC) — normalise. */
const normaliseUnit = (u: string): string => u.replace('μ', 'µ').trim()

const MASS_FACTORS: Record<string, Record<string, number>> = {
  g: { g: 1, mg: 1000, µg: 1_000_000 },
  mg: { g: 0.001, mg: 1, µg: 1000 },
  µg: { g: 0.000_001, mg: 0.001, µg: 1 },
}

interface UnitMismatch {
  column: string
  fromUnit: string
  toUnit: string
}

const convertValue = (
  value: number,
  fromUnit: string,
  toUnit: 'g' | 'mg' | 'µg' | 'kcal',
): number | undefined => {
  const from = normaliseUnit(fromUnit)
  if (from === toUnit) return value
  // Anything other than mass-to-mass we don't try to convert.
  if (toUnit === 'kcal') return undefined
  const factor = MASS_FACTORS[from]?.[toUnit]
  return factor === undefined ? undefined : value * factor
}

export interface MapResult {
  columns: Record<string, number>
  /**
   * Rows whose unit didn't match what our column expects but were converted.
   * In normal operation this should be empty (LSV is consistent per-nutrient);
   * non-empty means LSV's unit convention drifted and we should be told.
   */
  unitMismatches: UnitMismatch[]
}

/**
 * Translate an LSV nutrient array into our flat column dict. Skips rows
 * we don't have a column for and the kJ duplicate of ENERC. When a row's
 * unit doesn't match the column's expected unit, mass-to-mass values are
 * converted but recorded in `unitMismatches` so the runner can log loudly —
 * silently producing wrong-magnitude data is the worst failure mode.
 */
export const mapLsvNutrientsToColumns = (nutrients: LsvNutrient[]): MapResult => {
  const columns: Record<string, number> = {}
  const unitMismatches: UnitMismatch[] = []
  for (const row of nutrients) {
    const code = row.euroFIRkod
    const enhet = normaliseUnit(row.enhet)

    if (code === 'ENERC') {
      // Take the kcal duplicate, drop kJ.
      if (enhet === 'kcal') columns.calories = row.varde
      continue
    }

    const column = EUROFIR_TO_COLUMN[code]
    if (!column) continue

    const expectedUnit = COLUMN_UNITS[column]
    if (!expectedUnit) continue

    if (normaliseUnit(row.enhet) !== expectedUnit) {
      const converted = convertValue(row.varde, row.enhet, expectedUnit)
      if (converted !== undefined) {
        columns[column] = converted
        unitMismatches.push({ column, fromUnit: enhet, toUnit: expectedUnit })
      }
      continue
    }
    columns[column] = row.varde
  }
  return { columns, unitMismatches }
}

const buildHeaders = (): Record<string, string> => ({
  Accept: 'application/json',
  'User-Agent': 'aurboda/1.0 (+https://aurboda.net) livsmedelsverket-import',
})

export interface LsvClientOptions {
  baseUrl?: string
  fetch?: typeof fetch
}

const fetchJson = async <T>(url: string, opts: LsvClientOptions): Promise<T> => {
  const fetcher = opts.fetch ?? globalThis.fetch
  const res = await fetcher(url, { headers: buildHeaders() })
  if (!res.ok) throw new Error(`LSV ${res.status} ${res.statusText} at ${url}`)
  return (await res.json()) as T
}

/**
 * Fetch the full catalog: every page until count < limit. Returns the
 * combined list of {nummer, namn}. ~13 calls for 2575 foods at PAGE_SIZE=200.
 */
export const fetchLivsmedelsverketCatalog = async (opts: LsvClientOptions = {}): Promise<LsvFood[]> => {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
  const all: LsvFood[] = []
  let offset = 0
  for (;;) {
    const page = await fetchJson<LsvListResponse>(
      `${baseUrl}/api/v1/livsmedel?offset=${offset}&limit=${PAGE_SIZE}&sprak=1`,
      opts,
    )
    all.push(...page.livsmedel)
    if (page.livsmedel.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return all
}

export const fetchLivsmedelsverketFoodNutrients = async (
  nummer: number,
  opts: LsvClientOptions = {},
): Promise<LsvNutrient[]> => {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
  return fetchJson<LsvNutrient[]>(`${baseUrl}/api/v1/livsmedel/${nummer}/naringsvarden?sprak=1`, opts)
}

export interface LsvImportRunOptions extends LsvClientOptions {
  /** processed = imported + skipped (matches what's persisted). */
  onProgress?: (processed: number, skipped: number, total: number) => void | Promise<void>
  /** Polite delay between per-food fetches (ms). Defaults to 50. */
  perItemDelayMs?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Run the full import: fetch catalog, fetch nutrients per food, upsert into
 * the central shared_food_items library. Errors on individual foods are
 * logged and counted as skipped — we don't abort the whole job for one
 * bad row.
 */
export const runLivsmedelsverketImport = async (
  sharedFoodItems: SharedFoodItemsApi,
  opts: LsvImportRunOptions = {},
): Promise<{ totalCatalog: number; imported: number; skipped: number }> => {
  const catalog = await fetchLivsmedelsverketCatalog(opts)
  await opts.onProgress?.(0, 0, catalog.length)

  let imported = 0
  let skipped = 0
  let mismatchCount = 0
  const delay = opts.perItemDelayMs ?? 50

  for (let i = 0; i < catalog.length; i++) {
    const food = catalog[i]
    try {
      const nutrients = await fetchLivsmedelsverketFoodNutrients(food.nummer, opts)
      const { columns, unitMismatches } = mapLsvNutrientsToColumns(nutrients)
      if (unitMismatches.length > 0) {
        mismatchCount += unitMismatches.length
        for (const m of unitMismatches) {
          console.warn(
            `[lsv-import] unit mismatch nummer=${food.nummer} column=${m.column} from=${m.fromUnit} to=${m.toUnit} (LSV unit convention may have changed — verify before trusting these values)`,
          )
        }
      }
      const input: InsertSharedFoodItemInput = {
        ...columns,
        default_quantity: 100,
        default_unit: 'g',
        name: food.namn,
        source: 'livsmedelsverket',
        source_id: String(food.nummer),
      }
      await sharedFoodItems.upsertSharedFoodItem(input)
      imported++
    } catch (err) {
      skipped++
      console.warn(
        `[lsv-import] failed to import nummer=${food.nummer} namn="${food.namn}":`,
        err instanceof Error ? err.message : err,
      )
    }
    if (delay > 0) await sleep(delay)
    if ((i + 1) % 20 === 0 || i === catalog.length - 1) {
      await opts.onProgress?.(imported, skipped, catalog.length)
    }
  }

  if (mismatchCount > 0) {
    console.warn(
      `[lsv-import] completed with ${mismatchCount} unit mismatches across the catalog — see prior warnings`,
    )
  }
  console.info(`[lsv-import] done: ${imported} imported, ${skipped} skipped of ${catalog.length} total`)

  return { imported, skipped, totalCatalog: catalog.length }
}
